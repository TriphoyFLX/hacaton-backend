import { Response } from 'express';
import { AuthenticatedRequest } from '../types';
export declare function createBlockHandlers(): {
    blockUser: (req: AuthenticatedRequest, res: Response) => Promise<Response<any, Record<string, any>> | undefined>;
    unblockUser: (req: AuthenticatedRequest, res: Response) => Promise<Response<any, Record<string, any>> | undefined>;
    getBlockedUsers: (req: AuthenticatedRequest, res: Response) => Promise<Response<any, Record<string, any>> | undefined>;
    checkBlockStatus: (req: AuthenticatedRequest, res: Response) => Promise<Response<any, Record<string, any>> | undefined>;
};
//# sourceMappingURL=blockController.d.ts.map