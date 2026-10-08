// ══════════════════════════════════════════════════════════════
//  اختبار سلوك — يشغّل المعالجات الحقيقية على sock وهمي
//  يثبت: الحذف الفوري، الطرد بالمعرّف الصحيح، المنشن بالرقم
//  الحقيقي (وليس @lid)، منع التكرار، والقاعدة المرجعية لـ .راقب
// ══════════════════════════════════════════════════════════════
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadPlugins } from './accounts/art/handlers/plugins.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAQIB_STATE = path.join(__dirname, 'accounts/art/nova/data/raqib.json');
const STATE_BAK   = RAQIB_STATE + '.testbak';

// ⚠️ نحمي حالة البوت الحقيقية — نزيحها جانباً بـ(rename) لا نحذفها،
//    ونعيدها بعد الاختبار. (كان rmSync يمسح بيانات المستخدم الفعلية!)
function parkState() {
    try {
        if (fs.existsSync(STATE_BAK)) return;           // نسخة مزاحة سابقاً → لا نمسها
        if (fs.existsSync(RAQIB_STATE)) fs.renameSync(RAQIB_STATE, STATE_BAK);
    } catch (e) { console.error('park:', e.message); }
}
let stateRestored = false;
function restoreState() {
    if (stateRestored) return;                          // لا تنفّذ مرتين (exit + استدعاء يدوي)
    stateRestored = true;
    try {
        if (fs.existsSync(STATE_BAK)) {
            try { fs.rmSync(RAQIB_STATE, { force: true }); } catch {}
            fs.renameSync(STATE_BAK, RAQIB_STATE);
        } else if (fs.existsSync(RAQIB_STATE)) {
            fs.unlinkSync(RAQIB_STATE);                 // ما كان موجود قبلنا → ننظّف
        }
    } catch (e) { console.error('restore:', e.message); }
}
process.on('exit', restoreState);
process.on('SIGINT', () => { restoreState(); process.exit(130); });

parkState();   // نبدأ بحالة نظيفة للاختبار

let fail = 0;
const ok  = n => console.log(`  ✅ ${n}`);
const bad = (n, e) => { fail++; console.log(`  ❌ ${n} → ${e}`); };

const GID       = '120363000000000000@g.us';
const NOTIFY    = '120363411553835005@g.us';
const OWNER     = '213773231685';
const OWNER_JID = `${OWNER}@s.whatsapp.net`;
const ADMIN_JID = '2135550001@s.whatsapp.net';
const LID       = '104806312050733@lid';
const LID_PN    = '2135559999@s.whatsapp.net';
// أعضاء معزولين لكل سيناريو (يمنع تلوّث الـ cooldown بين الاختبارات)
const LID_B     = '104806312050734@lid';
const LID_B_PN  = '2135558888@s.whatsapp.net';
const LID_C     = '104806312050735@lid';
const LID_C_PN  = '2135557777@s.whatsapp.net';
// صاحب **يوزر**: أخفى رقمه → لا يوجد phoneNumber في بيانات القروب أصلاً
const U_LID      = '104806312050736@lid';
const U_USERNAME = 'Ahmed2026';

const META = {
    subject: 'مجموعة الاختبار',
    participants: [
        { id: OWNER_JID, admin: 'superadmin' },
        { id: ADMIN_JID, admin: 'admin' },
        { id: LID, lid: LID, phoneNumber: LID_PN },
        { id: LID_B, lid: LID_B, phoneNumber: LID_B_PN },
        { id: LID_C, lid: LID_C, phoneNumber: LID_C_PN },
        { id: U_LID, lid: U_LID, username: U_USERNAME },   // ⭐ بلا phoneNumber
    ],
};

// أرقام بلا أجهزة مرتبطة (لا يجب أن تُعلَّن)
const NO_DEVICE = new Set();

// ── sock وهمي ──
const calls = { send: [], kick: [], meta: 0, devices: 0 };

const sock = {
    user: { id: `${OWNER}:0@s.whatsapp.net`, lid: '777777@lid' },
    ev: { on() {}, off() {}, emit() {} },
    activeListeners: new Map(),

    async sendMessage(jid, content, opts) {
        calls.send.push({ jid, content, opts });
        return { key: { id: `S${calls.send.length}`, remoteJid: jid } };
    },
    async groupMetadata() { calls.meta++; return META; },
    async groupInviteCode() { return 'ABCD1234'; },
    async groupParticipantsUpdate(id, jids, act) { calls.kick.push({ id, jids, act }); },
    async groupFetchAllParticipating() {
        return { [GID]: { id: GID, subject: META.subject, participants: META.participants } };
    },
    async getUSyncDevices(jids) {
        calls.devices++;
        return jids
            .filter(j => !NO_DEVICE.has(j))
            .map(j => ({ user: j.split('@')[0], device: 1 }));
    },
};

const reset = () => { calls.send.length = 0; calls.kick.length = 0; calls.meta = 0; calls.devices = 0; };
const sendsTo = jid => calls.send.filter(s => s.jid === jid);
const contactMsg = (participant, participantAlt, id = 'M1') => ({
    key: { remoteJid: GID, participant, participantAlt, id, fromMe: false },
    message: { contactMessage: { displayName: 'X', vcard: 'BEGIN:VCARD' } },
});

await loadPlugins('#00FF00');
const { default: antiContact } = await import('./accounts/art/plugins/elite/anti-contact.js');
const { default: adminMon }     = await import('./accounts/art/plugins/games/admin-monitor.js');
const { default: raqib }        = await import('./accounts/art/plugins/games/raqib.js');

const antiHandler = global.messageEvHandlers.find(h => h.__pluginTag === 'anti-contact');
const adminHandler = global.groupEvHandlers.find(h => !h.__pluginTag);
const joinHandler  = global.groupEvHandlers.find(h => h.__pluginTag === 'raqib');

if (!antiHandler) { bad('antiHandler', 'غير موجود'); process.exit(1); }
if (!adminHandler) { bad('adminHandler', 'غير موجود'); process.exit(1); }
if (!joinHandler)  { bad('joinHandler', 'غير موجود'); process.exit(1); }

// ══════════════ A) مسح الجهات ══════════════
console.log('\n[A] مسح الجهات — عضو عادي يرسل بطاقة (lid)');

// ن warmed الكاش عبر استدعاء أول
reset();
await antiHandler(sock, contactMsg(LID, LID_PN, 'MA'));
await new Promise(r => setTimeout(r, 150));   // ننتظر الطابور

{
    const dels = calls.send.filter(s => s.content?.delete);
    if (dels.length === 1) ok('الحذف صار (طلب واحد) ✅');
    else bad('الحذف', `${dels.length} طلب (المطلوب 1)`);

    if (calls.kick.length === 1 && calls.kick[0].jids[0] === LID)
        ok(`الطرد بالمعرّف القيمي من القروب: ${calls.kick[0].jids[0]} ✅`);
    else bad('الطرد', JSON.stringify(calls.kick));

    const anns = calls.send.filter(s => s.jid === NOTIFY && s.content?.text?.includes('حـذف بـطـاقـة'));
    if (anns.length === 1) ok('إشعار واحد فقط (ما تكرر) ✅');
    else bad('عدد الإشعارات', `${anns.length} (المطلوب 1)`);

    const ann = anns[0];
    if (ann.content.mentions?.includes(LID_PN))
        ok('المنشن بالرقم الحقيقي ✅');
    else bad('المنشن', JSON.stringify(ann.content.mentions));

    if ((ann.content.mentions || []).some(m => m.endsWith('@lid')))
        bad('منشن @lid تسرب!', JSON.stringify(ann.content.mentions));
    else ok('لا يوجد أي @lid في الـ mentions ✅');

    const t = ann.content.text;

    if (t.includes('@2135559999')) ok('النص يعرض @2135559999');
    else bad('النص', t.split('\n').find(l => l.includes('@')));

    // زخرفة البوت الجديدة (مختلفة عن زخرفة "مراقب")
    if (t.includes('🌟') && !t.includes('🌿 .ৎ˚₊‧'))
        ok('زخرفة البوت الجديدة (وليست زخرفة مراقب) ✅');
    else bad('الزخرفة', t.split('\n')[0]);

    if (t.includes('مجموعة الاختبار'))
        ok('اسم القروب موجود ✅');
    else bad('اسم القروب', t.split('\n').join(' | ').slice(0, 200));

    if (t.includes('https://chat.whatsapp.com/ABCD1234'))
        ok('يحوي رابط القروب (كما طلبت) ✅');
    else bad('رابط إشعار المسح', t.slice(-160));

    const nonEmpty = t.split('\n').filter(l => l.trim());
    if (nonEmpty[nonEmpty.length - 1].includes('🕒'))
        ok('التوقيت في أسفل الرسالة ✅');
    else bad('موضع التوقيت', nonEmpty.slice(-2).join(' | '));

    // صيغة التوقيت الجديدة: *🕒 6‏/10‏/2026 ⪼ 17:32:45*
    const last = nonEmpty[nonEmpty.length - 1];
    if (/^\*🕒 \d+‏\/\d+‏\/\d{4} ⪼ \d{2}:\d{2}:\d{2}\*$/.test(last))
        ok('صيغة التوقيت الجديدة (تاريخ ⪼ ساعة) ✅');
    else bad('صيغة التوقيت', last);

    if (nonEmpty.some(l => l.includes('ᑲᥡ') && l.includes('𝚛𝚝𝚑𝚞𝚛')))
        ok('التوقيع الجديد: > ⪼ ᑲᥡ Arthur ✅');
    else bad('التوقيع', JSON.stringify(nonEmpty.slice(-3)));

    if (t.includes('اسـم الـجـروب'))
        ok('عنوان "اسـم الـجـروب" الجديد ✅');
    else bad('عنوان الجروب', t.split('\n').find(l => l.includes('الـجـروب')) || '—');
}

console.log('\n[A2] مسح الجهات — أدمن يرسل بطاقة');
reset();
await antiHandler(sock, contactMsg(ADMIN_JID, ADMIN_JID, 'MB'));
await new Promise(r => setTimeout(r, 150));

{
    if (calls.kick.length === 0) ok('ما طردنا الأدمن ✅');
    else bad('طرد الأدمن', JSON.stringify(calls.kick));

    const anns = calls.send.filter(s => s.jid === NOTIFY && s.content?.text?.includes('حـذف بـطـاقـة'));
    if (anns.length === 1 && anns[0].content.text.includes('معفى'))
        ok('أُعلن الحذف مع تنويه "معفى من الطرد" ✅');
    else bad('إشعار الأدمن', anns[0]?.content.text.slice(0, 80) || 'لا يوجد');
}

console.log('\n[A3] مسح الجهات — الأونر يرسل بطاقة');
reset();
await antiHandler(sock, contactMsg(OWNER_JID, OWNER_JID, 'MC'));
await new Promise(r => setTimeout(r, 150));

{
    if (calls.kick.length === 0) ok('ما طردنا الأونر ✅');
    else bad('طرد الأونر', JSON.stringify(calls.kick));
}

console.log('\n[A4] سبام — 5 بطاقات متتالية من نفس العضو (عضو جديد)');
reset();
for (let i = 0; i < 5; i++) {
    await antiHandler(sock, contactMsg(LID_C, LID_C_PN, `SPAM${i}`));
}
await new Promise(r => setTimeout(r, 600));

{
    const dels = calls.send.filter(s => s.content?.delete);
    if (dels.length === 5) ok(`كل الرسائل الخمس حُذفت ✅ (${dels.length}/5)`);
    else bad('حذف السبام', `${dels.length}/5`);

    if (calls.kick.length === 1) ok('طرد واحد فقط رغم السبام (dedupe) ✅');
    else bad('عدد الطرود', `${calls.kick.length} (المطلوب 1)`);

    const anns = calls.send.filter(s => s.jid === NOTIFY && s.content?.text?.includes('حـذف بـطـاقـة'));
    if (anns.length === 1) ok('إشعار واحد فقط رغم السبام ✅');
    else bad('إشعارات السبام', `${anns.length} (المطلوب 1)`);
}

// ══════════════ A5) السرعة ══════════════
console.log('\n[A5] السرعة — الكاش الدافئ: صفر طلبات شبكة');
reset();
for (let i = 0; i < 10; i++) {
    await antiHandler(sock, contactMsg(LID, LID_PN, `SPEED${i}`));
}
await new Promise(r => setTimeout(r, 600));

{
    if (calls.meta === 0)
        ok('10 رسائل جهة اتصال ← 0 طلب groupMetadata (كاش دافئ) ✅');
    else bad('طلبات شبكة', `${calls.meta} (المطلوب 0 عند الكاش الدافئ)`);

    const dels = calls.send.filter(s => s.content?.delete);
    if (dels.length === 10) ok('كلها حُذفت رغم عدم انتظار الشبكة ✅');
    else bad('الحذف', `${dels.length}/10`);
}

// ══════════════ A6) صاحب يوزر (بدون رقم هاتف) ══════════════
console.log(`\n[A6] صاحب يوزر @${U_USERNAME} — لا يوجد phoneNumber إطلاقاً`);

// هذا هو جذر الخلل: phoneNumber === undefined → resolvePn يرجع null
// → كانت مصفوفة المنشن تصير فاضية والنص يعرض أرقام lid بدون تنبيه
reset();
await antiHandler(sock, contactMsg(U_LID, undefined, 'USR1'));
await new Promise(r => setTimeout(r, 300));

{
    const anns = calls.send.filter(s => s.jid === NOTIFY && s.content?.text?.includes('حـذف بـطـاقـة'));
    if (anns.length === 1) ok('أُرسل إشعار واحد ✅');
    else bad('إشعار صاحب اليوزر', `${anns.length}`);

    const m = anns[0]?.content?.mentions || [];

    if (m.length > 0) ok(`المنشن لم يعد فاضياً: ${JSON.stringify(m)} ✅`);
    else bad('المنشن', 'مصفوفة فاضية ← لا تنبيه إطلاقاً (الخلل القديم)');

    if (m.includes(U_LID)) ok('يحتوي المعرّف الأصلي @lid الذي يستعمله واتساب نفسه ✅');
    else bad('المعرّف الأصلي', JSON.stringify(m));

    const t = anns[0]?.content?.text || '';
    if (t.includes(`@${U_USERNAME}`)) ok(`النص يعرض اليوزر @${U_USERNAME} (كما يعرضه واتساب) ✅`);
    else bad('نص اليوزر', t.split('\n').find(l => l.includes('@')) || '—');

    if (!t.includes('104806312050736'))
        ok('لا يعرض أرقام الـlid الخام في النص ✅');
    else bad('أرقام lid تسربت للنص', t.split('\n').find(l => l.includes('104806')) || '—');

    if (calls.kick.length === 1 && calls.kick[0].jids[0] === U_LID)
        ok('طُرد بالمعرّف الأصلي ✅');
    else bad('طرد صاحب اليوزر', JSON.stringify(calls.kick));
}

// 10 أعضاء مختلفين — لقياس أثر التجميع في عدد طلبات الطرد
const MANY = [];
for (let i = 0; i < 10; i++) {
    const lid = `1048063120508${String(i).padStart(3, '0')}@lid`;
    const pn  = `21355566${String(i).padStart(2, '0')}@s.whatsapp.net`;
    MANY.push({ lid, pn });
    META.participants.push({ id: lid, lid, phoneNumber: pn });
}

// ══════════════ A7) التجميع (السرعة) ══════════════
console.log('\n[A7] السرعة — 10 بطاقات من 10 أعضاء مختلفين');
reset();
for (const m of MANY) {
    await antiHandler(sock, contactMsg(m.lid, m.pn, `M${m.lid}`));
}
await new Promise(r => setTimeout(r, 800));

{
    const dels = calls.send.filter(s => s.content?.delete);
    if (dels.length === 10) ok('كل الرسائل العشر حُذفت فوراً ✅');
    else bad('الحذف السريع', `${dels.length}/10`);

    // ⭐ جوهر التسريع: طلب شبكة واحد بدل عشرة (كان كل طرد ينتظر فاصل)
    if (calls.kick.length <= 2) ok(`الطرد بـ${calls.kick.length} طلب فقط (كان 10 طلبات + 400ms لكل منها) ✅`);
    else bad('عدد طلبات الطرد', `${calls.kick.length} (المطلوب ≤2 — مجمّع واحد)`);

    const kicked = calls.kick.flatMap(k => k.jids);
    if (kicked.length === 10) ok('كل الأعضاء العشر طُردوا ✅');
    else bad('عدد المطرودين', `${kicked.length}/10 → ${JSON.stringify(calls.kick)}`);
}

// ══════════════ B) مراقبة الاشراف ══════════════
console.log('\n[B] مراقب — ترقية (author = @lid)');
reset();
await adminHandler(sock, {
    id: GID, action: 'promote', author: LID, authorPn: undefined,
    participants: [{ id: LID, lid: LID, phoneNumber: LID_PN }],
});

{
    const notes = sendsTo(NOTIFY);
    if (notes.length === 1) ok('أُرسل إشعار واحد إلى NOTIFY ✅');
    else bad('عدد الإشعارات', `${notes.length}`);

    const n = notes[0];
    if (n.content.mentions?.includes(LID_PN))
        ok('منشن الترقية بالرقم الحقيقي ✅');
    else bad('منشن الترقية', JSON.stringify(n.content.mentions));

    if ((n.content.mentions || []).some(m => m.endsWith('@lid')))
        bad('تسرب @lid في منشن الترقية!');
    else ok('لا @lid في منشن الترقية ✅');

    if (n.content.text.includes('https://chat.whatsapp.com/ABCD1234'))
        ok('إشعار الترقية يحوي رابط القروب ✅');
    else bad('رابط الترقية', n.content.text.slice(-100));
}

console.log('\n[B2] مراقب — authorPn يجي من الحدث (بدون تخمين)');
reset();
await adminHandler(sock, {
    id: GID, action: 'demote', author: ADMIN_JID, authorPn: ADMIN_JID,
    participants: [{ id: LID, phoneNumber: LID_PN }],
});
{
    const n = sendsTo(NOTIFY)[0];
    if (n && n.content.mentions.includes(ADMIN_JID) && n.content.mentions.includes(LID_PN))
        ok('كلا المنشنَين صحيحين (منفّذ + هدف) ✅');
    else bad('demote mentions', JSON.stringify(n?.content.mentions));
}

console.log('\n[B3] مراقب — طرد البوت (هدف جديد غير مستخدم)');
reset();
await adminHandler(sock, {
    id: GID, action: 'remove', author: OWNER_JID, authorPn: OWNER_JID,
    participants: [{ id: LID_B, phoneNumber: LID_B_PN }],
});

{
    const n = sendsTo(NOTIFY)[0];
    if (!n) { bad('إشعار طرد البوت', 'لم يُرسل'); }
    else {
        if (n.content.text.includes('طرد') && n.content.text.includes('البوت 🤖'))
            ok('إشعار الطرد ظهر مع "البوت 🤖" ✅');
        else bad('نص الطرد', n.content.text.slice(0, 120));

        if (n.content.text.includes('chat.whatsapp.com'))
            bad('إشعار الطرد يحوي رابط! (المطلوب اسم فقط)');
        else ok('بدون رابط — اسم القروب فقط ✅');

        if (n.content.mentions.includes(LID_B_PN))
            ok('منشن الطرد بالرقم الحقيقي ✅');
        else bad('منشن الطرد', JSON.stringify(n.content.mentions));
    }
}

console.log('\n[B4] مراقب — طرد أدمن يدوي (ليس البوت) يُتجاهل');
reset();
await adminHandler(sock, {
    id: GID, action: 'remove', author: ADMIN_JID, authorPn: ADMIN_JID,
    participants: [{ id: LID, phoneNumber: LID_PN }],
});
{
    if (sendsTo(NOTIFY).length === 0) ok('ما أُعلن عن طرد الأدمن اليدوي ✅');
    else bad('طرد يدوي', 'أُعلن رغم أنه ليس البوت');
}

console.log('\n[B5] مراقب — طرد البوت بعد ما أعلنه anti-contact (منع تكرار)');
reset();
await antiHandler(sock, contactMsg(LID, LID_PN, 'DEDUP'));
await new Promise(r => setTimeout(r, 150));
const before = sendsTo(NOTIFY).length;
await adminHandler(sock, {
    id: GID, action: 'remove', author: OWNER_JID, authorPn: OWNER_JID,
    participants: [{ id: LID, phoneNumber: LID_PN }],
});
{
    if (sendsTo(NOTIFY).length === before)
        ok('admin-monitor ما أعاد الإشعار (نفس حدث الطرد) ✅');
    else bad('منع التكرار', 'أُضيف إشعار مكرر في NOTIFY');
}

// ══════════════ C) .راقب ══════════════
console.log('\n[C] .راقب — أول فحص = قاعدة مرجعية (بدون إعلان)');
reset();
await raqib.execute({ sock, msg: { key: { remoteJid: OWNER_JID } }, args: ['فحص'] });

{
    const news = sendsTo(NOTIFY).filter(s => s.content?.text?.includes('عـضـو جـديـد'));
    if (news.length === 0) ok('القاعدة المرجعية ما أعلنت عن أحد ✅');
    else bad('القاعدة المرجعية', `${news.length} إشعار (سي flooding!)`);

    const st = JSON.parse(fs.readFileSync(RAQIB_STATE, 'utf8'));
    const g = st.groups[GID];

    // القاعدة المرجعية = كل من يملك رقماً قابلاً للحل
    // (صاحب اليوزر بلا phoneNumber يُتخطّى عمداً — لا معرّف صالح لاحقاً)
    const expectedBaseline = META.participants
        .filter(p => p.phoneNumber || String(p.id).endsWith('@s.whatsapp.net')).length;

    if (g && g.baseline && Object.keys(g.members).length === expectedBaseline)
        ok(`سُجّل ${expectedBaseline} عضواً كقاعدة مرجعية ✅`);
    else bad('الحالة', JSON.stringify(g && {
        baseline: g.baseline,
        n: Object.keys(g.members).length,
        expectedBaseline,
    }));
}

console.log('\n[C2] .راقب — عضو جديد انضم ومعه جهاز مرتبط');
const NEW_PN = '2137770001@s.whatsapp.net';
META.participants.push({ id: '999111222@lid', lid: '999111222@lid', phoneNumber: NEW_PN });

reset();
await raqib.execute({ sock, msg: { key: { remoteJid: OWNER_JID } }, args: ['فحص'] });

{
    const toGroup = sendsTo(GID).filter(s => s.content?.text?.includes('عـضـو جـديـد'));
    if (toGroup.length === 0) ok('ما أُرسل إلى مجموعة الحدث (كلشي لقروب واحد) ✅');
    else bad('تسرب لمجموعة الحدث', `${toGroup.length} رسالة`);

    const news = sendsTo(NOTIFY).filter(s => s.content?.text?.includes('عـضـو جـديـد'));
    if (news.length === 1) ok('إشعار واحد إلى NOTIFY_JID ✅');
    else bad('إشعار الانضمام', `${news.length} (المطلوب 1)`);

    const n = news[0];
    if (n.content.text.includes('عـضـو جـديـد رابـط جـهـاز'))
        ok('العنوان يوضّح وجود جهاز مرتبط ✅');
    else bad('العنوان', n.content.text.split('\n')[0]);

    if (n.content.mentions?.includes(NEW_PN)) ok('منشن العضو الجديد بالرقم الحقيقي ✅');
    else bad('منشن الانضمام', JSON.stringify(n.content.mentions));

    if ((n.content.mentions || []).some(m => m.endsWith('@lid')))
        bad('تسرب @lid في منشن الانضمام!');
    else ok('لا @lid في منشن الانضمام ✅');

    if (n.content.text.includes('https://chat.whatsapp.com/ABCD1234'))
        ok('يحوي رابط القروب (ضروري خارج مجموعة الحدث) ✅');
    else bad('رابط الانضمام', n.content.text.slice(-100));
}

console.log('\n[C2b] .راقب — عضو جديد انضم بدون أجهزة → لا إشعار');
const PLAIN_PN = '2136665555@s.whatsapp.net';
NO_DEVICE.add(PLAIN_PN);
META.participants.push({ id: '888777666@lid', lid: '888777666@lid', phoneNumber: PLAIN_PN });

reset();
await raqib.execute({ sock, msg: { key: { remoteJid: OWNER_JID } }, args: ['فحص'] });

{
    if (sendsTo(NOTIFY).length === 0)
        ok('انضمام عادي بدون أجهزة → صمت ✅');
    else bad('إشعار غير لازم', `${sendsTo(NOTIFY).length} رسالة لعضو بلا أجهزة`);

    const st = JSON.parse(fs.readFileSync(RAQIB_STATE, 'utf8'));
    const g = st.groups[GID];
    const key = Object.keys(g.members).find(k => k === '2136665555');
    if (key && g.members[key].notified && g.members[key].devices === 0)
        ok('سُجّل رغم عدم الإعلان (يُراقب لاحقاً) ✅');
    else bad('التسجيل', JSON.stringify(g.members[key]));
}

console.log('\n[C3] .راقب — فحص بدون تغيير = لا شيء (فقط الجديد)');
reset();
await raqib.execute({ sock, msg: { key: { remoteJid: OWNER_JID } }, args: ['فحص'] });
{
    if (sendsTo(NOTIFY).length === 0) ok('لا إشعار بدون تغيير ✅');
    else bad('إشعار زائف', `${sendsTo(NOTIFY).length} رسالة بلا سبب`);
}

console.log('\n[C4] .راقب — انضمام فوري عبر الحدث (مع جهاز)');
reset();
const FAST_PN = '2138880001@s.whatsapp.net';
await joinHandler(sock, {
    id: GID, action: 'add',
    participants: [{ id: '555666777@lid', lid: '555666777@lid', phoneNumber: FAST_PN }],
});
{
    const news = sendsTo(NOTIFY).filter(s => s.content?.text?.includes('عـضـو جـديـد'));
    if (news.length === 1 && news[0].content.mentions.includes(FAST_PN))
        ok('الكشف الفوري يفحص الأجهزة ويُرسل لـ NOTIFY ✅');
    else bad('الكشف الفوري', `${news.length} / ${JSON.stringify(news[0]?.content.mentions)}`);

    if (sendsTo(GID).length === 0) ok('ما أُرسل لمجموعة الحدث ✅');
    else bad('تسرب لمجموعة الحدث', `${sendsTo(GID).length}`);
}

console.log('\n[C4b] .راقب — انضمام فوري بلا أجهزة → لا إشعار');
reset();
const PLAIN2 = '2139990001@s.whatsapp.net';
NO_DEVICE.add(PLAIN2);
await joinHandler(sock, {
    id: GID, action: 'add',
    participants: [{ id: '444555666@lid', lid: '444555666@lid', phoneNumber: PLAIN2 }],
});
{
    if (sendsTo(NOTIFY).length === 0)
        ok('انضمام بلا أجهزة → صمت ✅');
    else bad('إشعار زائف', `${sendsTo(NOTIFY).length}`);
}

console.log('\n[C4c] .راقب — حدث الانضمام يجي بـ id:@lid فقط (بلا phoneNumber)');
const LIDONLY_PN = '2131234567@s.whatsapp.net';
META.participants.push({ id: '777888999@lid', lid: '777888999@lid', phoneNumber: LIDONLY_PN });

reset();
await joinHandler(sock, {
    id: GID, action: 'add',
    participants: [{ id: '777888999@lid' }],   // الحالة الحقيقية: بدون phoneNumber
});

{
    const news = sendsTo(NOTIFY).filter(s => s.content?.text?.includes('عـضـو جـديـد'));
    if (news.length !== 1) {
        bad('حُلّ الـlid', `لم يُرسل (${news.length}) — هذا كان سبب فشلك`);
    } else {
        if (news[0].content.mentions.includes(LIDONLY_PN))
            ok('حُلّ @lid من بيانات القروب ثم فُحصت أجهزته ✅');
        else bad('المنشن', JSON.stringify(news[0].content.mentions));

        if ((news[0].content.mentions || []).some(m => m.endsWith('@lid')))
            bad('تسرب @lid');
        else ok('لا @lid في الـ mentions ✅');
    }

    // المفتاح صار مطابقاً لـ scan → الفحص الدوري ما يعيد إعلانه
    const before = sendsTo(NOTIFY).length;
    // ".راقب فحص" يحفظ الحالة فوراً (saveState(true)) — من غيره الحفظ مؤجّل 2 ثانية
    await raqib.execute({ sock, msg: { key: { remoteJid: OWNER_JID } }, args: ['فحص'] });
    const dupes = sendsTo(NOTIFY).slice(before)
        .filter(s => s.content?.text?.includes('عـضـو جـديـد'));
    if (dupes.length === 0)
        ok('scan ما أعاد إعلانه كأنه منضم جديد ✅');
    else bad('إعلان مكرر من scan', `${dupes.length}`);

    const st = JSON.parse(fs.readFileSync(RAQIB_STATE, 'utf8'));
    const mem = st.groups[GID].members;
    const rec = mem['2131234567'];
    if (rec && rec.pn === LIDONLY_PN)
        ok('سُجّل الرقم الحقيقي كـ pn ✅');
    else bad('pn المسجّل', JSON.stringify(rec));

    // أهم فحص: ما لازم يصير فيه مفتاح من أرقام الـlid (يسبّب تسجيل مزدوج)
    if (!mem['777888999'])
        ok('لا مفتاح من أرقام الـlid (ما يتكرر مع scan) ✅');
    else bad('مفتاح lid!', 'نفس العضو يتسجّل مرتين → إعلان مكرر');
}

console.log('\n[C4d] .راقب — lid غير موجود في بيانات القروب → لا يُخترع رقم');
reset();
await joinHandler(sock, {
    id: GID, action: 'add',
    participants: [{ id: '111222333@lid' }],   // لا يوجد في META
});
{
    if (sendsTo(NOTIFY).length === 0)
        ok('ما بنينا رقم وهمي → صمت ✅');
    else bad('مخترع رقم', `${sendsTo(NOTIFY).length} إشعار برقم غير صحيح`);
}

console.log('\n[C5] .راقب — البوت نفسه ما يُعلن');
reset();
await joinHandler(sock, {
    id: GID, action: 'add',
    participants: [{ id: sock.user.id }],
});
{
    if (sendsTo(NOTIFY).length === 0) ok('انضمام البوت لم يُعلَن ✅');
    else bad('انضمام البوت', 'أُعلن عنه');
}

// ── تنظيف (يعيد حالة المستخدم كما كانت) ──
restoreState();

console.log(`\n${fail === 0 ? '🎉 كل اختبارات السلوك نجحت' : `⚠️  ${fail} فشل`}`);
process.exit(fail === 0 ? 0 : 1);
