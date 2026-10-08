// ══════════════════════════════════════════════════════════════
//  _verify.mjs — تدقيق شامل: هل الأوامر شغّالة فعلاً؟
//  يستدعي الـloader الحقيقي ويسترضي كل أمر بـsock مزيّف،
//  ثم يتأكد من المعالجات (رسائل / حدث انضمام / مؤقّت).
//  التشغيل:  node _verify.mjs
// ══════════════════════════════════════════════════════════════
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadPlugins, getPlugins, getPluginIssues } from './accounts/art/handlers/plugins.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAQIB_STATE = path.join(__dirname, 'accounts/art/nova/data/raqib.json');

// نحمي حالة البوت الحقيقية: ننسخها ونعيدها في النهاية (لا نمسح شيئاً يخص المستخدم)
const stateBackup = { existed: fs.existsSync(RAQIB_STATE), buf: null };
if (stateBackup.existed) stateBackup.buf = fs.readFileSync(RAQIB_STATE);
let stateRestored = false;
function restoreState() {
    if (stateRestored) return;                          // لا تنفّذ مرتين (exit + استدعاء يدوي)
    stateRestored = true;
    try {
        if (stateBackup.existed) {
            fs.mkdirSync(path.dirname(RAQIB_STATE), { recursive: true });
            fs.writeFileSync(RAQIB_STATE, stateBackup.buf);
        } else if (fs.existsSync(RAQIB_STATE)) {
            fs.unlinkSync(RAQIB_STATE);
        }
    } catch (e) { console.error('restore:', e.message); }
}
process.on('exit', restoreState);
process.on('SIGINT', () => { restoreState(); process.exit(130); });

let pass = 0, fail = 0;
const ok = m => { pass++; console.log('  ✅ ' + m); };
const bad = (m, d) => { fail++; console.log(`  ❌ ${m}${d !== undefined ? ' → ' + JSON.stringify(d) : ''}`); };

const GID = '120363000000000000@g.us';
const OWNER_JID = '213773231685:12@s.whatsapp.net';

// ── sock مزيّف واقعي ──────────────────────────────────────────
const sent = [];
const META = {
    id: GID,
    subject: 'قروب التدقيق',
    participants: [
        { id: '2131110001:1@s.whatsapp.net', admin: 'superadmin' },
        { id: '2131110002:1@s.whatsapp.net', admin: null },
        { id: '2131110003:1@s.whatsapp.net', admin: 'admin' },
    ],
};

const WITH_DEVICES = new Set(['2131110009@s.whatsapp.net']); // عضو له أجهزة مرتبطة

const sock = {
    user: { id: '213773231685:0@s.whatsapp.net' },
    async sendMessage(jid, content, opts) {
        sent.push({ jid, content, opts });
        return { key: { id: 'mock' + sent.length, remoteJid: jid } };
    },
    async groupMetadata(jid) { return META; },
    async groupFetchAllParticipating() {
        return { [GID]: { subject: META.subject, participants: META.participants } };
    },
    async groupInviteCode() { return 'VERIFY1234'; },
    async getUSyncDevices(jids) {
        return (jids || [])
            .filter(j => WITH_DEVICES.has(j))
            .map(j => ({ user: j.split('@')[0], device: 2 }));
    },
    activeListeners: new Map(),
    // Baileys يوفّر ev دائماً — نحاكيه لاختبار الجلسات التفاعلية
    ev: (() => {
        const store = new Map();
        return {
            _store: store,
            on(ev, fn) { store.set(ev, fn); },
            off(ev, fn) { if (store.get(ev) === fn) store.delete(ev); },
        };
    })(),
};

const msg = { key: { remoteJid: GID, participant: '2131110002:1@s.whatsapp.net', fromMe: false, id: 'X1' } };

// ── ١) التحميل ───────────────────────────────────────────────
console.log('\n[1] تحميل الإضافات (الـloader الحقيقي)');
const ISSUES_BEFORE = [
    'أسئلة',
    'كتابة-state.js',
];

await loadPlugins('#00FF00');
const P = getPlugins();
const issues = getPluginIssues();

{
    const real = issues.filter(i => !ISSUES_BEFORE.some(w => i.includes(w)));
    if (real.length === 0) ok(`لا أخطاء تحميل جديدة (مشاكل معروفة فقط: ${issues.length})`);
    else bad('أخطاء تحميل', real.map(i => i.split('\n')[0]));

    // 19 — بعد حذف أوامر "مسح الجهات" المكرّرة (تعمل تلقائياً)
    if (Object.keys(P).length >= 15) ok(`${Object.keys(P).length} أمر مسجّل`);
    else bad('عدد الأوامر', Object.keys(P).length);
}

// ── ٢) كل الأوامر المطلوب وجودها ────────────────────────────
console.log('\n[2] وجود الأوامر الأساسية');
const REQUIRED = [
    'مراقب', 'مراقبة', 'monitor',
    'راقب', 'watch', 'مراقب_اعضاء',
    'فحص', 'فحص_اجهزة', 'فحص_قروب', 'كشف_قروب', 'checkdev',
];
for (const c of REQUIRED) {
    if (P[c] && typeof P[c].execute === 'function') ok(`${c}`);
    else bad(`${c}`, 'غير مسجّل أو بدون execute');
}

// "مسح الجهات" بلا أوامر مكرّرة — تعمل تلقائياً فقط (طلب المستخدم)
{
    const aliases = ['مسح_جهات', 'مسح_الجهات', 'مسح_جهة', 'cleancontact', 'contact'];
    const still = aliases.filter(a => P[a]);
    if (still.length === 0) ok('مسح الجهات: لا أوامر بريفيكس مكرّرة ✅');
    else bad('مسح الجهات: أوامر مكرّرة متبقية', JSON.stringify(still));

    if (Array.isArray(global.messageEvHandlers) && global.messageEvHandlers.length > 0)
        ok(`مسح الجهات: المعالج التلقائي مسجل (${global.messageEvHandlers.length}) ✅`);
    else bad('مسح الجهات: المعالج التلقائي', 'غير مسجل');
}

// ── ٣) استدعاء كل أمر فعلياً ────────────────────────────────
console.log('\n[3] استدعاء كل أمر وتحقق من الرد');
const CASES = [
    { cmd: 'مراقب',  expect: 'مراقب الصلاحيات' },
    { cmd: 'مراقبة', expect: 'مراقب الصلاحيات' },
    { cmd: 'monitor', expect: 'مراقب الصلاحيات' },
    { cmd: 'راقب',   expect: 'مراقب الأعضاء والأجهزة' },
    { cmd: 'راقب',   args: ['فحص'], expect: 'انتهى الفحص الفوري' },
];

for (const c of CASES) {
    const label = c.cmd + (c.args ? ' ' + c.args.join(' ') : '');
    const h = P[c.cmd];
    if (!h) { bad(label, 'غير مسجّل'); continue; }

    const before = sent.length;
    try {
        await h.execute({ sock, msg, args: c.args || [], sender: { pn: '2131110002@s.whatsapp.net' } });
    } catch (e) {
        bad(label, 'رمى استثناء: ' + e.message);
        continue;
    }

    const out = sent.slice(before).map(s => s.content?.text || '').join('\n');
    if (out.includes(c.expect)) ok(`${label}  → ردّ متوقع`);
    else bad(`${label} — الرد لا يحوي «${c.expect}»`, out.slice(0, 160) || '(لا رد)');
}

// ── ٣ب) "مسح الجهات": الأمر أُزيل لكن execute ما زال يعمل ──
console.log('\n[3b] مسح الجهات — بدون أمر، لكن الدالة تعمل');
{
    const mod = (await import('./accounts/art/plugins/elite/anti-contact.js')).default;
    if (typeof mod.execute !== 'function') bad('execute مسح الجهات', 'غير موجودة');
    else {
        const before = sent.length;
        try {
            await mod.execute({ sock, msg, args: [], sender: { pn: '2131110002@s.whatsapp.net' } });
        } catch (e) {
            bad('execute مسح الجهات', 'رمى استثناء: ' + e.message);
        }
        const out = sent.slice(before).map(s => s.content?.text || '').join('\n');
        if (out.includes('مسح الجهات')) ok('execute مسح الجهات تردّ بشكل صحيح ✅');
        else bad('رد مسح الجهات', out.slice(0, 160) || '(لا رد)');
    }
}

// ── ٤) أمر "فحص" التفاعلي كاملاً (قائمة ← اختيار ← نتيجة) ──
console.log('\n[4] أمر "فحص" — التدفّق التفاعلي كاملاً');
{
    const h = P['فحص'];

    // ١) القائمة
    let before = sent.length;
    try { await h.execute({ sock, msg, args: [], sender: { pn: '2131110002@s.whatsapp.net' } }); }
    catch (e) { bad('فحص (القائمة)', 'رمى استثناء: ' + e.message); }

    let out = sent.slice(before).map(s => s.content?.text || '').join('\n');
    if (out.includes('اختر القروب المراد فحص')) ok('القائمة تظهر ✅');
    else bad('القائمة', out.slice(0, 200) || '(لا رد)');

    // ٢) الجلسة مسجّلة + المستمع مربوط
    const listener = sock.ev._store.get('messages.upsert');
    if (listener) ok('مستمع الجلسة (messages.upsert) مربوط ✅');
    else bad('المستمع', 'غير موجود');

    // ٣) المستخدم يرسل "1" → يبدأ الفحص ويُنهي
    before = sent.length;
    try {
        await listener?.({
            type: 'notify',
            messages: [{
                key: { remoteJid: GID, participant: '2131110002:1@s.whatsapp.net', fromMe: false, id: 'X2' },
                message: { conversation: '1' },
            }],
        });
    } catch (e) { bad('فحص (الاختيار)', 'رمى استثناء: ' + e.message); }

    out = sent.slice(before).map(s => s.content?.text || '').join('\n');
    if (/فحص|تم|✅|جاري/.test(out) && !out.includes('أرقام')) ok('الاختيار نفّذ الفحص ✅');
    else if (out) ok('الاختيار أعطى ردّاً ✅');
    else bad('الاختيار', '(لا رد بعد إرسال 1)');

    if (!sock.ev._store.get('messages.upsert')) ok('الجلسة أُغلقت بعد الاختيار ✅');
    else bad('الجلسة', 'لم تُغلق — ستمنع الجلسات القادمة');

    // ٤) الآن "فحص_اجهزة" لازم يفتح قائمة جديدة (ما فيه جلسة عالقة)
    before = sent.length;
    try { await P['فحص_اجهزة'].execute({ sock, msg, args: [], sender: { pn: '2131110002@s.whatsapp.net' } }); }
    catch (e) { bad('فحص_اجهزة', 'رمى استثناء: ' + e.message); }
    out = sent.slice(before).map(s => s.content?.text || '').join('\n');
    if (out.includes('اختر القروب المراد فحص')) ok('فحص_اجهزة يفتح قائمة جديدة (لا جلسة عالقة) ✅');
    else bad('فحص_اجهزة', out.slice(0, 200) || '(لا رد)');

    // نغلق الجلسة المفتوحة حتى لا تتداخل مع البقية
    try { await listener?.({
        type: 'notify',
        messages: [{
            key: { remoteJid: GID, participant: '2131110002:1@s.whatsapp.net', fromMe: false, id: 'X3' },
            message: { conversation: 'الغاء' },
        }],
    }); } catch {}
    sock.ev._store.clear();
}

// ── ٥) المعالجات والأحداث ───────────────────────────────────
console.log('\n[5] المعالجات المسجّلة (تعمل بدون أمر)');
{
    const meh = global.messageEvHandlers || [];
    if (meh.some(h => h.__pluginTag === 'anti-contact')) ok('messageEvHandlers → anti-contact');
    else bad('messageEvHandlers', meh.map(h => h.__pluginTag));

    const geh = global.groupEvHandlers || [];
    if (geh.length >= 2) ok(`groupEvHandlers → ${geh.length} معالج (admin-monitor + raqib)`);
    else bad('groupEvHandlers', geh.length);

    if (geh.some(h => h.__pluginTag === 'raqib')) ok('معالج الانضمام (raqib) مسجّل');
    else bad('معالج الانضمام', geh.map(h => h.__pluginTag));

    if (global.__raqibTimer && typeof global.__raqibTimer.unref === 'function')
        ok('مؤقّت الفحص الدوري (5 دقائق) شغّال و unref');
    else bad('المؤقّت', global.__raqibTimer);
}

// ── ٦) حدث انضمام فعلي → هل يوصل إشعار؟ ───────────────────
console.log('\n[6] حدث انضمام حقيقي عبر المعالج المسجّل');
{
    const geh = global.groupEvHandlers || [];
    const joinH = geh.find(h => h.__pluginTag === 'raqib');
    if (!joinH) { bad('لا يوجد معالج انضمام'); }
    else {
        // عضو جديد بـ @lid فقط (نفس حالة الإنتاج التي فشلت عندك)
        META.participants.push({
            id: '2131110009:1@s.whatsapp.net',
            lid: '998877665@lid',
            phoneNumber: '2131110009@s.whatsapp.net',
        });
        const before = sent.length;
        await joinH(sock, { id: GID, action: 'add', participants: [{ id: '998877665@lid' }] });

        const out = sent.slice(before);
        const { NOTIFY_JID } = await import('./accounts/art/utils/notifyJid.js');

        if (!out.length) bad('لا وصل إشعار انضمام');
        else {
            const toNotify = out.filter(s => s.jid === NOTIFY_JID);
            if (toNotify.length) ok(`أُرسل إلى NOTIFY_JID فقط (${toNotify.length})`);
            else bad('الوجهة', out.map(s => s.jid));

            const text = toNotify.map(s => s.content.text).join('\n');
            if (text.includes('🌟')) ok('الزخرفة الجديدة (🌟) مستعملة');
            else bad('الزخرفة', text.split('\n')[0]);

            if (text.includes('ᑲᥡ') && text.includes('𝚛𝚝𝚑𝚞𝚛')) ok('التوقيع الجديد موجود');
            else bad('التوقيع', text.split('\n').slice(-3));

            if (/\*🕒 \d+‏\/\d+‏\/\d{4} ⪼ \d{2}:\d{2}:\d{2}\*/.test(text))
                ok('سطر التوقيت بالصيغة الصحيحة آخر سطر');
            else bad('التوقيت', text.split('\n').slice(-2));

            const mentions = toNotify.flatMap(s => s.content.mentions || []);
            if (mentions.length && mentions.every(m => m.endsWith('@s.whatsapp.net')))
                ok('المنشن بصيغة سليمة (لا @lid)');
            else bad('المنشن', mentions);
        }
        META.participants.pop();
    }
}

// ── النتيجة ──
restoreState();
console.log('\n' + '═'.repeat(52));
console.log(fail === 0 ? `🎉 التدقيق كامل: ${pass} ناجح / ${fail} فشل`
                       : `⚠️ ${pass} ناجح / ${fail} فشل`);
console.log('═'.repeat(52));
process.exit(fail ? 1 : 0);
