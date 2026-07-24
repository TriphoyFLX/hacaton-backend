import { Router, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import { createProfileHandlers } from '../controllers/profileController';
import { AuthenticatedRequest } from '../types';

type AuthMiddleware = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => void | Promise<void>;

export function createProfileRouter(
  authenticateToken: AuthMiddleware,
  uploadsDir: string
): Router {
  const router = Router();
  const handlers = createProfileHandlers(uploadsDir);

  const avatarUpload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, uploadsDir),
      filename: (_req, file, cb) => {
        const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
        cb(null, uniqueSuffix + path.extname(file.originalname));
      },
    }),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const allowed = /jpeg|jpg|png|gif|webp/;
      const extOk = allowed.test(path.extname(file.originalname).toLowerCase());
      const mimeOk = file.mimetype.startsWith('image/');
      if (extOk || mimeOk) {
        cb(null, true);
      } else {
        cb(new Error('Invalid file type. Allowed: JPEG, PNG, GIF, WEBP'));
      }
    },
  });

  const optionalAuth = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.headers.authorization) {
      return next();
    }
    return authenticateToken(req, res, next);
  };

  const handleAvatarUpload = (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ) => {
    avatarUpload.single('avatar')(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: 'File too large. Max 5MB' });
        }
        return res.status(400).json({ error: err.message });
      }
      if (err) {
        return res.status(400).json({ error: err.message });
      }
      next();
    });
  };

  router.get('/search', optionalAuth, handlers.searchUsers);
  router.get('/', authenticateToken, handlers.getMyProfile);
  router.patch('/', authenticateToken, handlers.updateProfile);
  router.post('/avatar', authenticateToken, handleAvatarUpload, handlers.uploadAvatar);
  router.delete('/avatar', authenticateToken, handlers.deleteAvatar);
  router.get('/:identifier/soundtoks', optionalAuth, handlers.getUserSoundToks);
  router.get('/:identifier/liked-soundtoks', optionalAuth, handlers.getUserLikedSoundToks);
  router.get('/:identifier/reposted-soundtoks', optionalAuth, handlers.getUserRepostedSoundToks);
  router.get('/:identifier', optionalAuth, handlers.getPublicProfile);

  return router;
}
