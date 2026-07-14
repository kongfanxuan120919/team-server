const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { getStore } = require('@netlify/blobs');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

// ========== Blob Storage ==========
let store;

async function initStore() {
    try {
        store = getStore('team-data');
        console.log('✅ Blob Storage 已连接');
    } catch (error) {
        console.log('⚠️ 使用内存存储（本地开发）');
        let memoryData = null;
        store = {
            get: async (key) => {
                if (key === 'data.json' && memoryData) return memoryData;
                return null;
            },
            set: async (key, value) => {
                if (key === 'data.json') memoryData = value;
                return true;
            }
        };
    }
}

async function readData() {
    try {
        const data = await store.get('data.json');
        if (!data) {
            const initialData = {
                users: [], teams: [], discussions: [], public_files: [], private_files: [],
                chat_messages: {}, reports: [], punishments: [], titles: [], reg_requests: [], announces: []
            };
            await store.set('data.json', JSON.stringify(initialData));
            return initialData;
        }
        return JSON.parse(data);
    } catch (error) {
        return { users: [], teams: [], discussions: [], public_files: [], private_files: [], chat_messages: {}, reports: [], punishments: [], titles: [], reg_requests: [], announces: [] };
    }
}

async function writeData(data) {
    try {
        await store.set('data.json', JSON.stringify(data));
        return true;
    } catch (error) {
        console.error('❌ 写入数据失败:', error);
        return false;
    }
}

await initStore();

function generateId() {
    return Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 6);
}

function verifyToken(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: '未登录' });
    try {
        const decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
        req.user = decoded;
        next();
    } catch {
        res.status(401).json({ error: '登录已过期' });
    }
}

// ========== 用户 API ==========

app.post('/api/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        const data = await readData();
        if (data.users.find(u => u.username === username)) {
            return res.status(400).json({ error: '用户名已存在' });
        }
        const isAdmin = data.users.length === 0;
        const user = { id: generateId(), username, password, isAdmin, isLeader: false, createdAt: new Date().toISOString() };
        data.users.push(user);
        await writeData(data);
        res.json({ success: true, isAdmin });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const data = await readData();
        const user = data.users.find(u => u.username === username && u.password === password);
        if (!user) return res.status(401).json({ error: '用户名或密码错误' });
        const token = jwt.sign({ id: user.id, username: user.username, isAdmin: user.isAdmin }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ success: true, token, user: { id: user.id, username: user.username, isAdmin: user.isAdmin, isLeader: user.isLeader || false } });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/auto-login', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: '未登录' });
    try {
        const decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
        const data = await readData();
        const user = data.users.find(u => u.id === decoded.id);
        if (!user) return res.status(401).json({ error: '用户不存在' });
        const token = jwt.sign({ id: user.id, username: user.username, isAdmin: user.isAdmin }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ success: true, token, user: { id: user.id, username: user.username, isAdmin: user.isAdmin, isLeader: user.isLeader || false } });
    } catch {
        res.status(401).json({ error: '登录已过期' });
    }
});

app.get('/api/users', verifyToken, async (req, res) => {
    const data = await readData();
    res.json(data.users.map(u => ({ id: u.id, username: u.username, isAdmin: u.isAdmin, isLeader: u.isLeader || false })));
});

app.put('/api/users/:id', verifyToken, async (req, res) => {
    const data = await readData();
    const user = data.users.find(u => u.id === req.params.id);
    if (!user) return res.status(404).json({ error: '用户不存在' });
    Object.assign(user, req.body);
    await writeData(data);
    res.json({ success: true });
});

app.delete('/api/users/:id', verifyToken, async (req, res) => {
    const data = await readData();
    data.users = data.users.filter(u => u.id !== req.params.id);
    await writeData(data);
    res.json({ success: true });
});

// ========== 团队 API ==========

app.get('/api/teams', async (req, res) => {
    const data = await readData();
    res.json(data.teams || []);
});

app.post('/api/teams', verifyToken, async (req, res) => {
    const data = await readData();
    const team = { ...req.body, id: generateId(), createdAt: new Date().toISOString() };
    if (!data.teams) data.teams = [];
    data.teams.push(team);
    await writeData(data);
    res.json(team);
});

app.put('/api/teams/:id', verifyToken, async (req, res) => {
    const data = await readData();
    const team = data.teams.find(t => t.id === req.params.id);
    if (!team) return res.status(404).json({ error: '团队不存在' });
    Object.assign(team, req.body);
    await writeData(data);
    res.json({ success: true });
});

app.delete('/api/teams/:id', verifyToken, async (req, res) => {
    const data = await readData();
    data.teams = data.teams.filter(t => t.id !== req.params.id);
    await writeData(data);
    res.json({ success: true });
});

// ========== 讨论区 API ==========

app.get('/api/discussions', async (req, res) => {
    const data = await readData();
    res.json(data.discussions || []);
});

app.post('/api/discussions', verifyToken, async (req, res) => {
    const data = await readData();
    const post = { ...req.body, id: generateId(), timestamp: Date.now() };
    if (!data.discussions) data.discussions = [];
    data.discussions.push(post);
    await writeData(data);
    res.json(post);
});

app.put('/api/discussions/:id', verifyToken, async (req, res) => {
    const data = await readData();
    const post = data.discussions.find(p => p.id === req.params.id);
    if (!post) return res.status(404).json({ error: '帖子不存在' });
    Object.assign(post, req.body);
    await writeData(data);
    res.json({ success: true });
});

app.delete('/api/discussions/:id', verifyToken, async (req, res) => {
    const data = await readData();
    data.discussions = data.discussions.filter(p => p.id !== req.params.id);
    await writeData(data);
    res.json({ success: true });
});

// ========== 公共文件 API ==========

app.get('/api/public-files', async (req, res) => {
    const data = await readData();
    res.json(data.public_files || []);
});

app.post('/api/public-files', verifyToken, async (req, res) => {
    const data = await readData();
    const file = { ...req.body, id: generateId(), uploadedAt: new Date().toISOString() };
    if (!data.public_files) data.public_files = [];
    data.public_files.push(file);
    await writeData(data);
    res.json(file);
});

app.delete('/api/public-files/:id', verifyToken, async (req, res) => {
    const data = await readData();
    data.public_files = data.public_files.filter(f => f.id !== req.params.id);
    await writeData(data);
    res.json({ success: true });
});

// ========== 私密文件 API ==========

app.get('/api/private-files', async (req, res) => {
    const data = await readData();
    res.json(data.private_files || []);
});

app.post('/api/private-files', verifyToken, async (req, res) => {
    const data = await readData();
    const file = { ...req.body, id: generateId(), uploadedAt: new Date().toISOString(), allowedUsers: req.body.allowedUsers || [] };
    if (!data.private_files) data.private_files = [];
    data.private_files.push(file);
    await writeData(data);
    res.json(file);
});

app.put('/api/private-files/:id', verifyToken, async (req, res) => {
    const data = await readData();
    const file = data.private_files.find(f => f.id === req.params.id);
    if (!file) return res.status(404).json({ error: '文件不存在' });
    Object.assign(file, req.body);
    await writeData(data);
    res.json({ success: true });
});

app.delete('/api/private-files/:id', verifyToken, async (req, res) => {
    const data = await readData();
    data.private_files = data.private_files.filter(f => f.id !== req.params.id);
    await writeData(data);
    res.json({ success: true });
});

// ========== 私信 API ==========

app.get('/api/messages/:user1/:user2', async (req, res) => {
    const data = await readData();
    const key = [req.params.user1, req.params.user2].sort().join('_');
    res.json(data.chat_messages?.[key] || []);
});

app.post('/api/messages', verifyToken, async (req, res) => {
    const data = await readData();
    const msg = { ...req.body, id: generateId(), timestamp: Date.now(), read: false };
    const key = [msg.sender, msg.receiver].sort().join('_');
    if (!data.chat_messages) data.chat_messages = {};
    if (!data.chat_messages[key]) data.chat_messages[key] = [];
    data.chat_messages[key].push(msg);
    await writeData(data);
    res.json(msg);
});

// ========== 举报 API ==========

app.get('/api/reports', verifyToken, async (req, res) => {
    const data = await readData();
    res.json(data.reports || []);
});

app.post('/api/reports', verifyToken, async (req, res) => {
    const data = await readData();
    const report = { ...req.body, id: generateId(), timestamp: Date.now(), status: 'pending' };
    if (!data.reports) data.reports = [];
    data.reports.push(report);
    await writeData(data);
    res.json(report);
});

app.put('/api/reports/:id', verifyToken, async (req, res) => {
    const data = await readData();
    const report = data.reports.find(r => r.id === req.params.id);
    if (report) { report.status = req.body.status;
        await writeData(data); }
    res.json({ success: true });
});

// ========== 惩罚 API ==========

app.get('/api/punishments', verifyToken, async (req, res) => {
    const data = await readData();
    res.json(data.punishments || []);
});

app.post('/api/punishments', verifyToken, async (req, res) => {
    const data = await readData();
    const p = { ...req.body, id: generateId() };
    if (!data.punishments) data.punishments = [];
    const existing = data.punishments.find(pun => pun.username === p.username);
    if (existing) Object.assign(existing, p);
    else data.punishments.push(p);
    await writeData(data);
    res.json(p);
});

app.delete('/api/punishments/:id', verifyToken, async (req, res) => {
    const data = await readData();
    data.punishments = data.punishments.filter(p => p.id !== req.params.id);
    await writeData(data);
    res.json({ success: true });
});

// ========== 头衔 API ==========

app.get('/api/titles', async (req, res) => {
    const data = await readData();
    res.json(data.titles || []);
});

app.post('/api/titles', verifyToken, async (req, res) => {
    const data = await readData();
    const existing = (data.titles || []).find(t => t.username === req.body.username);
    if (existing) existing.title = req.body.title;
    else { if (!data.titles) data.titles = [];
        data.titles.push({ ...req.body, id: generateId() }); }
    await writeData(data);
    res.json({ success: true });
});

app.delete('/api/titles/:username', verifyToken, async (req, res) => {
    const data = await readData();
    data.titles = (data.titles || []).filter(t => t.username !== req.params.username);
    await writeData(data);
    res.json({ success: true });
});

// ========== 注册申请 API ==========

app.get('/api/reg-requests', verifyToken, async (req, res) => {
    const data = await readData();
    res.json(data.reg_requests || []);
});

app.post('/api/reg-requests', async (req, res) => {
    const data = await readData();
    const reqData = { ...req.body, id: generateId(), timestamp: Date.now() };
    if (!data.reg_requests) data.reg_requests = [];
    data.reg_requests.push(reqData);
    await writeData(data);
    res.json(reqData);
});

app.delete('/api/reg-requests/:id', verifyToken, async (req, res) => {
    const data = await readData();
    data.reg_requests = data.reg_requests.filter(r => r.id !== req.params.id);
    await writeData(data);
    res.json({ success: true });
});

// ========== 公告 API ==========

app.get('/api/announces', async (req, res) => {
    const data = await readData();
    res.json(data.announces || []);
});

app.post('/api/announces', verifyToken, async (req, res) => {
    const data = await readData();
    const announce = { ...req.body, id: generateId(), timestamp: Date.now() };
    if (!data.announces) data.announces = [];
    data.announces.push(announce);
    await writeData(data);
    res.json(announce);
});

app.delete('/api/announces/:id', verifyToken, async (req, res) => {
    const data = await readData();
    data.announces = data.announces.filter(a => a.id !== req.params.id);
    await writeData(data);
    res.json({ success: true });
});

// ========== 启动 ==========
app.listen(PORT, '0.0.0.0', () => {
    console.log('========================================');
    console.log('🚀 服务器启动成功！');
    console.log(`📍 访问地址: http://localhost:${PORT}`);
    console.log('📁 数据存储: Netlify Blob Storage');
    console.log('========================================');
});
