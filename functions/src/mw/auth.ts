import * as admin from 'firebase-admin';

if (!admin.apps.length) admin.initializeApp();

export async function requireAuth(req: any, res: any, next: any) {
  try {
    const h = req.headers.authorization ?? '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : '';
    if (!token) return res.status(401).json({ error: 'Missing token' });

    const decoded = await admin.auth().verifyIdToken(token);
    req.user = {
      uid: decoded.uid,
      email: decoded.email,
      org_id: (decoded as any).org_id ?? null,
      role:  (decoded as any).role   ?? 'user',
    };
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}
