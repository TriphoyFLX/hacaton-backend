"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const app_1 = __importDefault(require("./app"));
const database_1 = __importDefault(require("./config/database"));
const logger_1 = __importDefault(require("./utils/logger"));
const PORT = process.env.PORT || 5000;
async function startServer() {
    try {
        await database_1.default.$connect();
        logger_1.default.info('Database connected successfully');
        const server = app_1.default.listen(PORT, () => {
            logger_1.default.info(`Server is running on port ${PORT}`);
            logger_1.default.info(`Environment: ${process.env.NODE_ENV}`);
        });
        const gracefulShutdown = async (signal) => {
            logger_1.default.info(`Received ${signal}. Shutting down gracefully...`);
            server.close(async () => {
                logger_1.default.info('HTTP server closed');
                try {
                    await database_1.default.$disconnect();
                    logger_1.default.info('Database connection closed');
                    process.exit(0);
                }
                catch (error) {
                    logger_1.default.error('Error during shutdown:', error);
                    process.exit(1);
                }
            });
        };
        process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
        process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    }
    catch (error) {
        logger_1.default.error('Failed to start server:', error);
        process.exit(1);
    }
}
startServer();
//# sourceMappingURL=index.js.map