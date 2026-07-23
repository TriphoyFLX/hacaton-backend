"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPresetRouter = createPresetRouter;
const client_1 = require("@prisma/client");
const express_1 = require("express");
const fs_1 = __importDefault(require("fs"));
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const MAX_PACKAGE_BYTES = 100 * 1024 * 1024;
const MAX_MEDIA_BYTES = 12 * 1024 * 1024;
const sellerSelect = { id: true, username: true, displayName: true, avatar: true };
function deleteFile(filePath) {
    if (filePath && fs_1.default.existsSync(filePath))
        fs_1.default.unlinkSync(filePath);
}
function createPresetRouter(prisma, authenticateToken, uploadsDir, privatePresetsDir) {
    const router = (0, express_1.Router)();
    const presetMediaDir = path_1.default.join(uploadsDir, 'preset-media');
    const stagingDir = path_1.default.join(privatePresetsDir, '.staging');
    [presetMediaDir, privatePresetsDir, stagingDir].forEach((dir) => fs_1.default.mkdirSync(dir, { recursive: true }));
    const upload = (0, multer_1.default)({
        storage: multer_1.default.diskStorage({
            destination: (_req, _file, cb) => cb(null, stagingDir),
            filename: (_req, file, cb) => {
                const ext = path_1.default.extname(file.originalname).toLowerCase();
                cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
            },
        }),
        limits: { fileSize: MAX_PACKAGE_BYTES, files: 3 },
        fileFilter: (_req, file, cb) => {
            const ext = path_1.default.extname(file.originalname).toLowerCase();
            const mime = file.mimetype.toLowerCase();
            const valid = file.fieldname === 'package'
                ? ext === '.zip' || mime === 'application/zip' || mime === 'application/x-zip-compressed'
                : file.fieldname === 'preview'
                    ? /\.(mp3|wav|ogg|flac|m4a|aac)$/i.test(ext) || mime.startsWith('audio/')
                    : file.fieldname === 'cover'
                        ? /\.(jpg|jpeg|png|webp)$/i.test(ext) || mime.startsWith('image/')
                        : false;
            if (valid) {
                cb(null, true);
            }
            else {
                cb(new Error('Unsupported file type'));
            }
        },
    });
    const receiveAssets = (req, res, next) => {
        upload.fields([{ name: 'package', maxCount: 1 }, { name: 'preview', maxCount: 1 }, { name: 'cover', maxCount: 1 }])(req, res, (error) => {
            if (!error)
                return next();
            if (error instanceof multer_1.default.MulterError && error.code === 'LIMIT_FILE_SIZE') {
                return res.status(413).json({ error: 'Package must not exceed 100 MB' });
            }
            return res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid upload' });
        });
    };
    const optionalAuth = (req, res, next) => req.headers.authorization ? authenticateToken(req, res, next) : next();
    const isOwnerOrAdmin = (preset, user) => Boolean(user && (preset.sellerId === user.id || user.role === 'ADMIN'));
    router.get('/', optionalAuth, async (req, res) => {
        try {
            const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
            const tag = typeof req.query.tag === 'string' ? req.query.tag.trim() : '';
            const sort = req.query.sort === 'price_asc' || req.query.sort === 'price_desc' ? req.query.sort : 'newest';
            const presets = await prisma.preset.findMany({
                where: {
                    status: client_1.PresetStatus.PUBLISHED,
                    ...(q ? { OR: [{ title: { contains: q, mode: 'insensitive' } }, { description: { contains: q, mode: 'insensitive' } }] } : {}),
                    ...(tag ? { tags: { has: tag } } : {}),
                },
                include: { seller: { select: sellerSelect }, purchases: req.user ? { where: { buyerId: req.user.id, status: 'PAID' }, select: { id: true } } : false },
                orderBy: sort === 'price_asc' ? { priceCents: 'asc' } : sort === 'price_desc' ? { priceCents: 'desc' } : { createdAt: 'desc' },
            });
            res.json(presets.map(({ purchases, ...preset }) => ({ ...preset, purchased: Boolean(purchases?.length), isSeller: preset.sellerId === req.user?.id })));
        }
        catch (error) {
            console.error('preset catalog error:', error);
            res.status(500).json({ error: 'Failed to fetch presets' });
        }
    });
    router.get('/mine', authenticateToken, async (req, res) => {
        const presets = await prisma.preset.findMany({
            where: { sellerId: req.user.id },
            include: { _count: { select: { purchases: true } } },
            orderBy: { updatedAt: 'desc' },
        });
        res.json(presets);
    });
    router.get('/library', authenticateToken, async (req, res) => {
        const purchases = await prisma.presetPurchase.findMany({
            where: { buyerId: req.user.id, status: 'PAID' },
            include: { preset: { include: { seller: { select: sellerSelect } } } },
            orderBy: { purchasedAt: 'desc' },
        });
        res.json(purchases.map(({ preset, ...purchase }) => ({ ...preset, purchase })));
    });
    router.get('/admin/all', authenticateToken, async (req, res) => {
        if (req.user.role !== 'ADMIN')
            return res.status(403).json({ error: 'Admin access required' });
        const presets = await prisma.preset.findMany({
            include: { seller: { select: sellerSelect }, _count: { select: { purchases: true } } },
            orderBy: { updatedAt: 'desc' },
        });
        res.json(presets);
    });
    router.post('/', authenticateToken, async (req, res) => {
        try {
            const { title, description, priceCents = 0, tags = [] } = req.body;
            const price = Number(priceCents);
            if (typeof title !== 'string' || title.trim().length < 3 || typeof description !== 'string' || description.trim().length < 10) {
                return res.status(400).json({ error: 'Title must be at least 3 and description at least 10 characters' });
            }
            if (!Number.isInteger(price) || price < 0 || price > 10000000)
                return res.status(400).json({ error: 'Invalid price' });
            const normalizedTags = Array.isArray(tags) ? tags.filter((tag) => typeof tag === 'string').map((tag) => tag.trim().slice(0, 32)).filter(Boolean).slice(0, 10) : [];
            const preset = await prisma.preset.create({
                data: { sellerId: req.user.id, title: title.trim().slice(0, 100), description: description.trim().slice(0, 5000), priceCents: price, tags: normalizedTags },
            });
            res.status(201).json(preset);
        }
        catch (error) {
            console.error('create preset error:', error);
            res.status(500).json({ error: 'Failed to create preset' });
        }
    });
    router.patch('/:id', authenticateToken, async (req, res) => {
        const preset = await prisma.preset.findUnique({ where: { id: req.params.id } });
        if (!preset)
            return res.status(404).json({ error: 'Preset not found' });
        if (!isOwnerOrAdmin(preset, req.user))
            return res.status(403).json({ error: 'Forbidden' });
        const { title, description, priceCents, tags, status } = req.body;
        if (status && !Object.values(client_1.PresetStatus).includes(status))
            return res.status(400).json({ error: 'Invalid status' });
        if (status === client_1.PresetStatus.PUBLISHED && !preset.packageKey)
            return res.status(400).json({ error: 'Upload a ZIP package before publishing' });
        const updated = await prisma.preset.update({
            where: { id: preset.id },
            data: {
                ...(typeof title === 'string' ? { title: title.trim().slice(0, 100) } : {}),
                ...(typeof description === 'string' ? { description: description.trim().slice(0, 5000) } : {}),
                ...(priceCents !== undefined && Number.isInteger(Number(priceCents)) && Number(priceCents) >= 0 ? { priceCents: Number(priceCents) } : {}),
                ...(Array.isArray(tags) ? { tags: tags.filter((tag) => typeof tag === 'string').map((tag) => tag.trim().slice(0, 32)).filter(Boolean).slice(0, 10) } : {}),
                ...(status ? { status } : {}),
            },
        });
        res.json(updated);
    });
    router.post('/:id/assets', authenticateToken, receiveAssets, async (req, res) => {
        const preset = await prisma.preset.findUnique({ where: { id: req.params.id } });
        if (!preset)
            return res.status(404).json({ error: 'Preset not found' });
        if (!isOwnerOrAdmin(preset, req.user))
            return res.status(403).json({ error: 'Forbidden' });
        const files = req.files;
        const packageFile = files?.package?.[0];
        const previewFile = files?.preview?.[0];
        const coverFile = files?.cover?.[0];
        if (!packageFile && !previewFile && !coverFile)
            return res.status(400).json({ error: 'No files uploaded' });
        const movePublic = (file) => {
            const destination = path_1.default.join(presetMediaDir, file.filename);
            fs_1.default.renameSync(file.path, destination);
            return `/uploads/preset-media/${file.filename}`;
        };
        const movePrivate = (file) => {
            const destination = path_1.default.join(privatePresetsDir, file.filename);
            fs_1.default.renameSync(file.path, destination);
            return file.filename;
        };
        try {
            const packageKey = packageFile ? movePrivate(packageFile) : undefined;
            const previewUrl = previewFile ? movePublic(previewFile) : undefined;
            const coverUrl = coverFile ? movePublic(coverFile) : undefined;
            if (packageKey && preset.packageKey)
                deleteFile(path_1.default.join(privatePresetsDir, preset.packageKey));
            const updated = await prisma.preset.update({
                where: { id: preset.id },
                data: {
                    ...(packageFile ? { packageKey, packageName: packageFile.originalname, packageSize: packageFile.size } : {}),
                    ...(previewUrl ? { previewUrl } : {}),
                    ...(coverUrl ? { coverUrl } : {}),
                },
            });
            res.json(updated);
        }
        catch (error) {
            [packageFile, previewFile, coverFile].forEach((file) => deleteFile(file?.path));
            console.error('preset upload error:', error);
            res.status(500).json({ error: 'Failed to save preset assets' });
        }
    });
    router.post('/:id/checkout', authenticateToken, async (req, res) => {
        const preset = await prisma.preset.findUnique({ where: { id: req.params.id } });
        if (!preset || preset.status !== client_1.PresetStatus.PUBLISHED || !preset.packageKey)
            return res.status(404).json({ error: 'Preset not available' });
        if (preset.sellerId === req.user.id)
            return res.status(400).json({ error: 'You already own this preset' });
        const purchase = await prisma.presetPurchase.upsert({
            where: { buyerId_presetId: { buyerId: req.user.id, presetId: preset.id } },
            update: { status: 'PAID' },
            create: { buyerId: req.user.id, presetId: preset.id, amountCents: preset.priceCents, currency: preset.currency, provider: 'demo', providerRef: `demo_${Date.now()}` },
        });
        res.json({ purchase, demo: true, message: preset.priceCents ? 'Demo checkout completed' : 'Preset added to your library' });
    });
    router.get('/:id/download', authenticateToken, async (req, res) => {
        const preset = await prisma.preset.findUnique({ where: { id: req.params.id } });
        if (!preset?.packageKey || !preset.packageName)
            return res.status(404).json({ error: 'Package not found' });
        const allowed = isOwnerOrAdmin(preset, req.user) || Boolean(await prisma.presetPurchase.findFirst({ where: { buyerId: req.user.id, presetId: preset.id, status: 'PAID' } }));
        if (!allowed)
            return res.status(403).json({ error: 'Purchase required to download this preset' });
        const filePath = path_1.default.join(privatePresetsDir, preset.packageKey);
        if (!fs_1.default.existsSync(filePath))
            return res.status(404).json({ error: 'Package file not found' });
        res.download(filePath, preset.packageName);
    });
    router.patch('/admin/:id/status', authenticateToken, async (req, res) => {
        if (req.user.role !== 'ADMIN')
            return res.status(403).json({ error: 'Admin access required' });
        const { status } = req.body;
        if (!Object.values(client_1.PresetStatus).includes(status))
            return res.status(400).json({ error: 'Invalid status' });
        const preset = await prisma.preset.update({ where: { id: req.params.id }, data: { status } }).catch(() => null);
        if (!preset)
            return res.status(404).json({ error: 'Preset not found' });
        res.json(preset);
    });
    router.delete('/:id', authenticateToken, async (req, res) => {
        const preset = await prisma.preset.findUnique({ where: { id: req.params.id } });
        if (!preset)
            return res.status(404).json({ error: 'Preset not found' });
        if (!isOwnerOrAdmin(preset, req.user))
            return res.status(403).json({ error: 'Forbidden' });
        if (preset.packageKey)
            deleteFile(path_1.default.join(privatePresetsDir, preset.packageKey));
        await prisma.preset.delete({ where: { id: preset.id } });
        res.status(204).send();
    });
    router.get('/:id', optionalAuth, async (req, res) => {
        const preset = await prisma.preset.findUnique({
            where: { id: req.params.id },
            include: { seller: { select: sellerSelect }, purchases: req.user ? { where: { buyerId: req.user.id, status: 'PAID' }, select: { id: true } } : false },
        });
        if (!preset || (preset.status !== client_1.PresetStatus.PUBLISHED && !isOwnerOrAdmin(preset, req.user)))
            return res.status(404).json({ error: 'Preset not found' });
        const { purchases, ...data } = preset;
        res.json({ ...data, purchased: Boolean(purchases?.length), isSeller: preset.sellerId === req.user?.id });
    });
    return router;
}
//# sourceMappingURL=presetRoutes.js.map