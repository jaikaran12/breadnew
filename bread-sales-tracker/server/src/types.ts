export interface AuthDriver {
  id: number;
  name: string;
  phone: string;
}

export interface AuthAdmin {
  id: number;
  name: string;
  username: string;
}

export type PaymentMode = 'cash' | 'upi' | 'credit';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      driver?: AuthDriver;
      admin?: AuthAdmin;
    }
  }
}
