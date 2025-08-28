// 先頭付近はそのまま
if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const ALLOWLIST = [
  'http://localhost:5173',
  'https://rinto-mvp.web.app',
  'https://rinto-mvp.firebaseapp.com',
  // 'https://rinto-mvp.web.app',
];

const app = express();

// ✅ 1) まず最初に trust proxy
app.set('trust proxy', 1);

// ✅ 2) Helmet（そのままでOK）
app.use(helmet());

// ✅ 3) JSON ボディ上限を 1MB に拡張
app.use(express.json({ limit: '1mb' }));

// ✅ 4) CORS（プリフライトも許可）
app.use(
  cors({
    origin(origin, cb) {
      if (!origin || ALLOWLIST.includes(origin)) return cb(null, true);
      return cb(new Error('Not allowed by CORS'));
    },
    credentials: true,
  })
);

// ✅ 5) レート制限（OPTIONSとヘルスチェックは除外）
app.use(
  rateLimit({
    windowMs: 60_000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.method === 'OPTIONS' || req.path === '/healthz',
  })
);

// ✅ 6) ヘルスチェック
app.get('/healthz', (_req, res) => res.status(200).send('ok'));

// （以下、エンドポイントは現状どおり）
app.get('/trees/search', requireAuth, async (req, res) => {
  try {
    const snap = await db.collection('trees').limit(500).get();
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json({ items });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/reports', requireAuth, validateBody(ReportSchema), async (req: any, res) => {
  try {
    const payload = {
      ...req.body,
      created_by: req.user.uid,
      created_at: admin.firestore.FieldValue.serverTimestamp(),
    };
    const doc = await db.collection('reports').add(payload);
    res.json({ id: doc.id });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/plans', requireAuth, validateBody(PlanSchema), async (req: any, res) => {
  try {
    const payload = {
      ...req.body,
      created_by: req.user.uid,
      created_at: admin.firestore.FieldValue.serverTimestamp(),
    };
    const doc = await db.collection('plans').add(payload);
    res.json({ id: doc.id });
  } catch (e: any) {
    res.status(500).js
