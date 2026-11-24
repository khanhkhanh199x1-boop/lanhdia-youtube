import type { Request, Response } from 'express';

export class ApiFault extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export function ok(res: Response, data: unknown, message = 'Thành công', status = 200) {
  return res.status(status).json({ success: true, code: 'OK', message, data });
}

export function fail(res: Response, status: number, code: string, message: string) {
  return res.status(status).json({ success: false, code, message });
}

export function wrap(handler: (req: Request, res: Response) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    try { await handler(req, res); }
    catch (err) {
      if (res.headersSent) return;
      if (err instanceof ApiFault) return fail(res, err.status, err.code, err.message);
      return fail(res, 500, 'SERVER_ERROR', err instanceof Error ? err.message : 'Lỗi máy chủ.');
    }
  };
}
