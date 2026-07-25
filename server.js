const express = require('express');
const initSqlJs = require('sql.js');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
let db;
const DB_FILE = path.join(ROOT, 'data', 'teo-store.db');
function createDbWrapper(sqlDb) {
  const persist = () => fs.writeFileSync(DB_FILE, Buffer.from(sqlDb.export()));
  return {
    exec(sql) { sqlDb.run(sql); persist(); },
    prepare(sql) {
      return {
        get(...args) { const stmt = sqlDb.prepare(sql); stmt.bind(args); const row = stmt.step() ? stmt.getAsObject() : undefined; stmt.free(); return row; },
        all(...args) { const stmt = sqlDb.prepare(sql); stmt.bind(args); const rows = []; while (stmt.step()) rows.push(stmt.getAsObject()); stmt.free(); return rows; },
        run(...args) { const stmt = sqlDb.prepare(sql); stmt.bind(args); stmt.run(); stmt.free(); const row = sqlDb.exec('SELECT last_insert_rowid() AS id'); persist(); return { lastInsertRowid: row[0]?.values?.[0]?.[0] || 0 }; }
      };
    },
    transaction(fn) { fn(); persist(); }
  };
}

fs.mkdirSync(path.join(ROOT, 'uploads'), { recursive: true });
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(ROOT, 'uploads')));
app.use(express.static(path.join(ROOT, 'public')));

const upload = multer({
  dest: path.join(ROOT, 'uploads'),
  limits: { fileSize: 6 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, /^image\/(jpeg|png|webp|gif)$/.test(file.mimetype))
});

async function initDb() {
  const SQL = await initSqlJs({ locateFile: (file) => path.join(ROOT, 'node_modules', 'sql.js', 'dist', file) });
  const existing = fs.existsSync(DB_FILE) ? new Uint8Array(fs.readFileSync(DB_FILE)) : undefined;
  db = createDbWrapper(existing ? new SQL.Database(existing) : new SQL.Database());
  db.exec(`
    CREATE TABLE IF NOT EXISTS categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL, accent TEXT NOT NULL DEFAULT '#243b6b', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', image TEXT NOT NULL, price INTEGER NOT NULL, price_label TEXT NOT NULL DEFAULT '', badge TEXT DEFAULT NULL, popular INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY AUTOINCREMENT, order_number TEXT UNIQUE NOT NULL, customer_name TEXT NOT NULL, customer_contact TEXT NOT NULL, transaction_id TEXT NOT NULL, proof_path TEXT, status TEXT NOT NULL DEFAULT 'pending', rejection_reason TEXT, delivery_data TEXT, total INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS order_items (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE, product_id INTEGER NOT NULL REFERENCES products(id), product_name TEXT NOT NULL, quantity INTEGER NOT NULL, unit_price INTEGER NOT NULL);
  `);
  const categoryCount = db.prepare('SELECT COUNT(*) AS count FROM categories').get().count;
  if (!categoryCount) {
    const insertCategory = db.prepare('INSERT INTO categories (name, slug, accent) VALUES (?, ?, ?)');
    const categories = [
      ['اشتراكات الذكاء الاصطناعي', 'ai', '#6675f5'],
      ['أدوات إبداعية', 'creative', '#ff6b8a'],
      ['ترفيه وموسيقى', 'entertainment', '#ffb347'],
      ['بطاقات هدايا', 'gift-cards', '#31c48d'],
      ['شحن الألعاب', 'gaming', '#5aa7ff']
    ];
    const ids = categories.map((c) => insertCategory.run(...c).lastInsertRowid);
    const insertProduct = db.prepare('INSERT INTO products (category_id, name, description, image, price, price_label, badge, popular) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    const products = [
      [ids[0], 'ChatGPT Plus', 'حساب موثوق • تفعيل سريع', 'https://cdn.simpleicons.org/openai/ffffff', 189, 'ابتداءً من 189 د.م', 'الأكثر مبيعاً', 1],
      [ids[0], 'Claude Pro', 'إنتاجية أذكى، كل يوم', 'https://cdn.simpleicons.org/anthropic/ffffff', 199, 'ابتداءً من 199 د.م', null, 0],
      [ids[0], 'Gemini Advanced', 'قوة Google AI بين يديك', 'https://cdn.simpleicons.org/googlegemini/ffffff', 159, 'ابتداءً من 159 د.م', null, 0],
      [ids[1], 'Canva Pro', 'إبداع بلا حدود للمصممين', 'https://cdn.simpleicons.org/canva/ffffff', 119, 'ابتداءً من 119 د.م', 'اختيار TEO', 1],
      [ids[1], 'CapCut Pro', 'اصنع فيديوهات توقف التمرير', 'https://cdn.simpleicons.org/capcut/ffffff', 99, 'ابتداءً من 99 د.م', null, 0],
      [ids[2], 'Spotify Premium', 'موسيقى بلا إعلانات', 'https://cdn.simpleicons.org/spotify/ffffff', 79, 'ابتداءً من 79 د.م', 'الأكثر مبيعاً', 1],
      [ids[2], 'Netflix Premium', 'أفلام ومسلسلات بجودة 4K', 'https://cdn.simpleicons.org/netflix/ffffff', 129, 'ابتداءً من 129 د.م', null, 0],
      [ids[3], 'بطاقة Apple Gift Card', 'للتطبيقات والألعاب وأكثر', 'https://cdn.simpleicons.org/apple/ffffff', 100, 'قيم متعددة من 50 د.م', null, 0],
      [ids[4], 'PUBG Mobile UC', 'اشحن شداتك فوراً', 'https://cdn.simpleicons.org/pubg/ffffff', 49, 'ابتداءً من 49 د.م', 'سريع جداً', 1],
      [ids[4], 'Free Fire Diamonds', 'جواهر فري فاير', 'https://cdn.simpleicons.org/garena/ffffff', 39, 'ابتداءً من 39 د.م', null, 0],
      [ids[4], 'PlayStation Gift Card', 'متعة ألعاب بلا توقف', 'https://cdn.simpleicons.org/playstation/ffffff', 150, 'قيم متعددة من 50 د.م', null, 0]
    ];
    products.forEach((p) => insertProduct.run(...p));
  }
  const settingCount = db.prepare('SELECT COUNT(*) AS count FROM settings').get().count;
  if (!settingCount) {
    const insert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
    insert.run('store_name', 'TEO STORE');
    insert.run('payment_instructions', 'حوّل المبلغ إلى إحدى طرق الدفع التالية ثم أرسل رقم العملية وإثبات الدفع.');
    insert.run('payment_methods', JSON.stringify([
      { name: 'تحويل بنكي', details: 'البنك الشعبي • 001 810 0000000000000000 45', icon: 'bank' },
      { name: 'محفظة إلكترونية', details: 'واتساب باي • 06 00 00 00 00', icon: 'wallet' }
    ]));
    insert.run('support_contact', 'support@teostore.ma');
  }
}
const sessions = new Map();
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@teostore.ma';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'TEO-Admin-2026';
function createSession() {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { createdAt: Date.now() });
  return token;
}
function adminOnly(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.headers.cookie?.match(/teo_admin=([^;]+)/)?.[1];
  if (!token || !sessions.has(token)) return res.status(401).json({ error: 'غير مصرح' });
  req.sessionToken = token;
  next();
}
function money(value) { return `${Number(value).toLocaleString('ar-MA')} د.م`; }
function orderNumber() { return `TEO-${new Date().getFullYear()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`; }
function settingsObject() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  return Object.fromEntries(rows.map(({ key, value }) => [key, key === 'payment_methods' ? JSON.parse(value) : value]));
}
function getStoreData() {
  const categories = db.prepare('SELECT * FROM categories ORDER BY id').all();
  const products = db.prepare(`SELECT p.*, c.name AS category_name, c.slug AS category_slug, c.accent AS category_accent FROM products p JOIN categories c ON c.id = p.category_id WHERE p.active = 1 ORDER BY p.popular DESC, p.id`).all();
  return { categories, products, settings: settingsObject() };
}

app.get('/api/store', (_req, res) => res.json(getStoreData()));
app.post('/api/orders', upload.single('proof'), (req, res) => {
  try {
    const { customerName, customerContact, transactionId, items } = req.body;
    if (!customerName?.trim() || !customerContact?.trim() || !transactionId?.trim() || !req.file || !items) return res.status(400).json({ error: 'أكمل جميع البيانات وأرفق صورة إثبات الدفع' });
    const parsedItems = JSON.parse(items);
    if (!Array.isArray(parsedItems) || !parsedItems.length) return res.status(400).json({ error: 'السلة فارغة' });
    const productIds = parsedItems.map((item) => Number(item.productId));
    const placeholders = productIds.map(() => '?').join(',');
    const products = db.prepare(`SELECT * FROM products WHERE active = 1 AND id IN (${placeholders})`).all(...productIds);
    let total = 0;
    const normalized = parsedItems.map((item) => {
      const product = products.find((p) => p.id === Number(item.productId));
      const quantity = Math.max(1, Math.min(20, Number(item.quantity) || 1));
      if (!product) throw new Error('منتج غير متاح');
      total += product.price * quantity;
      return { product, quantity };
    });
    const number = orderNumber();
    const transaction = db.transaction(() => {
      const result = db.prepare('INSERT INTO orders (order_number, customer_name, customer_contact, transaction_id, proof_path, total) VALUES (?, ?, ?, ?, ?, ?)').run(number, customerName.trim(), customerContact.trim(), transactionId.trim(), `/uploads/${req.file.filename}`, total);
      const itemStmt = db.prepare('INSERT INTO order_items (order_id, product_id, product_name, quantity, unit_price) VALUES (?, ?, ?, ?, ?)');
      normalized.forEach(({ product, quantity }) => itemStmt.run(result.lastInsertRowid, product.id, product.name, quantity, product.price));
    });
    transaction();
    res.status(201).json({ orderNumber: number, total, message: 'تم استلام طلبك وسيتم مراجعته قريباً' });
  } catch (error) {
    if (req.file) fs.rmSync(req.file.path, { force: true });
    res.status(400).json({ error: error.message || 'تعذر إنشاء الطلب' });
  }
});
app.get('/api/orders/track', (req, res) => {
  const { orderNumber: number, contact } = req.query;
  if (!number || !contact) return res.status(400).json({ error: 'أدخل رقم الطلب ووسيلة التواصل' });
  const order = db.prepare('SELECT * FROM orders WHERE order_number = ? AND customer_contact = ?').get(String(number).trim().toUpperCase(), String(contact).trim());
  if (!order) return res.status(404).json({ error: 'لم نجد طلباً بهذه البيانات' });
  order.items = db.prepare('SELECT product_name, quantity, unit_price FROM order_items WHERE order_id = ?').all(order.id);
  order.total_label = money(order.total);
  res.json(order);
});
app.post('/api/admin/login', (req, res) => {
  if (req.body.email !== ADMIN_EMAIL || req.body.password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'بيانات الدخول غير صحيحة' });
  const token = createSession();
  res.json({ token, email: ADMIN_EMAIL });
});
app.post('/api/admin/logout', adminOnly, (req, res) => { sessions.delete(req.sessionToken); res.json({ ok: true }); });
app.get('/api/admin/me', adminOnly, (_req, res) => res.json({ email: ADMIN_EMAIL }));
app.get('/api/admin/overview', adminOnly, (_req, res) => {
  const counts = db.prepare(`SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending, SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed, COALESCE(SUM(CASE WHEN status = 'completed' THEN total ELSE 0 END), 0) AS revenue FROM orders`).get();
  res.json({ ...counts, revenue_label: money(counts.revenue) });
});
app.get('/api/admin/orders', adminOnly, (req, res) => {
  const status = req.query.status;
  const orders = db.prepare(`SELECT * FROM orders ${status && status !== 'all' ? 'WHERE status = ?' : ''} ORDER BY created_at DESC`).all(...(status && status !== 'all' ? [status] : []));
  orders.forEach((order) => { order.items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id); });
  res.json(orders);
});
app.patch('/api/admin/orders/:id', adminOnly, (req, res) => {
  const { status, deliveryData, rejectionReason } = req.body;
  if (!['pending', 'completed', 'rejected'].includes(status)) return res.status(400).json({ error: 'حالة غير صحيحة' });
  if (status === 'completed' && !deliveryData?.trim()) return res.status(400).json({ error: 'أدخل بيانات التسليم قبل الموافقة' });
  db.prepare('UPDATE orders SET status = ?, delivery_data = ?, rejection_reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(status, deliveryData || null, rejectionReason || null, req.params.id);
  res.json({ ok: true });
});
app.get('/api/admin/products', adminOnly, (_req, res) => res.json(db.prepare('SELECT p.*, c.name AS category_name FROM products p JOIN categories c ON c.id = p.category_id ORDER BY p.id DESC').all()));
app.post('/api/admin/products', adminOnly, (req, res) => {
  const { categoryId, name, description, image, price, priceLabel, badge, popular, active } = req.body;
  if (!categoryId || !name?.trim() || !price) return res.status(400).json({ error: 'الاسم والفئة والسعر مطلوبة' });
  const result = db.prepare('INSERT INTO products (category_id, name, description, image, price, price_label, badge, popular, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(categoryId, name.trim(), description || '', image || 'https://cdn.simpleicons.org/box/ffffff', Number(price), priceLabel || `ابتداءً من ${price} د.م`, badge || null, popular ? 1 : 0, active === false ? 0 : 1);
  res.status(201).json({ id: result.lastInsertRowid });
});
app.patch('/api/admin/products/:id', adminOnly, (req, res) => {
  const { categoryId, name, description, image, price, priceLabel, badge, popular, active } = req.body;
  db.prepare('UPDATE products SET category_id = ?, name = ?, description = ?, image = ?, price = ?, price_label = ?, badge = ?, popular = ?, active = ? WHERE id = ?').run(categoryId, name, description || '', image, Number(price), priceLabel || `ابتداءً من ${price} د.م`, badge || null, popular ? 1 : 0, active === false ? 0 : 1, req.params.id);
  res.json({ ok: true });
});
app.delete('/api/admin/products/:id', adminOnly, (req, res) => { db.prepare('UPDATE products SET active = 0 WHERE id = ?').run(req.params.id); res.json({ ok: true }); });
app.get('/api/admin/categories', adminOnly, (_req, res) => res.json(db.prepare('SELECT * FROM categories ORDER BY id').all()));
app.post('/api/admin/categories', adminOnly, (req, res) => { const { name, slug, accent } = req.body; if (!name || !slug) return res.status(400).json({ error: 'الاسم والمعرف مطلوبان' }); const result = db.prepare('INSERT INTO categories (name, slug, accent) VALUES (?, ?, ?)').run(name, slug, accent || '#243b6b'); res.status(201).json({ id: result.lastInsertRowid }); });
app.put('/api/admin/settings', adminOnly, (req, res) => {
  const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  const allowed = ['payment_instructions', 'payment_methods', 'support_contact'];
  allowed.forEach((key) => { if (req.body[key] !== undefined) upsert.run(key, typeof req.body[key] === 'string' ? req.body[key] : JSON.stringify(req.body[key])); });
  res.json(settingsObject());
});
app.use((_req, res) => res.sendFile(path.join(ROOT, 'public', 'index.html')));
initDb().then(() => app.listen(PORT, '0.0.0.0', () => console.log(`TEO STORE running on ${PORT}`))).catch((error) => { console.error(error); process.exit(1); });
