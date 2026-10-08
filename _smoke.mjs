// اختبار دخان — يتحقق من تحميل البلوجينات وعقد التصدير والزخرفة
import { loadPlugins, getPluginIssues } from './accounts/art/handlers/plugins.js';

let fail = 0;
const ok  = (n) => console.log(`  ✅ ${n}`);
const bad = (n, e) => { fail++; console.log(`  ❌ ${n} → ${e}`); };

// ── ١) تحميل كل البلوجينات عبر المُحمّل الحقيقي ──
console.log('\n[1] loadPlugins()');
const plugins = await loadPlugins('#00FF00');
let issues = getPluginIssues();
// موجود مسبقاً في المستودع الأصلي: ملف حالة مشترك داخل مجلد plugins/
const KNOWN_PREEXISTING = ['كتابة-state.js'];
const realIssues = issues.filter(i => !KNOWN_PREEXISTING.some(k => i.includes(k)));
if (realIssues.length) bad('plugin issues', JSON.stringify(realIssues, null, 2));
else ok('لا مشاكل تحميل جديدة' + (issues.length ? ` (${issues.length} موجودة مسبقاً في المستودع)` : ''));

const expect = [
  'مراقب', 'مراقبة', 'monitor',
  'راقب', 'watch', 'مراقب_اعضاء',
  'فحص', 'فحص_اجهزة', 'فحص_قروب', 'كشف_قروب', 'checkdev',
  'jid', 'رابط', 'اعدادات',
];

for (const cmd of expect) {
  const h = plugins[cmd];
  if (!h) { bad(`command "${cmd}"`, 'غير مسجل'); continue; }
  if (typeof h.execute !== 'function') { bad(`command "${cmd}"`, 'execute ليس دالة'); continue; }
  if (!h.command && !h.NovaUltra) { bad(`command "${cmd}"`, 'بلا command'); continue; }
  ok(`command "${cmd}" → ${h.description || '(بلا وصف)'}`);
}

// ── "مسح الجهات" بلا أوامر بريفيكس مكرّرة (تعمل تلقائياً فقط) ──
console.log('\n[1b] مسح الجهات — بلا أوامر مكرّرة');
{
  const aliases = ['مسح_جهات', 'مسح_الجهات', 'مسح_جهة', 'cleancontact', 'contact'];
  const still = aliases.filter(a => plugins[a]);
  if (still.length === 0)
    ok('لا أوامر بريفيكس متبقية (تعمل تلقائياً) ✅');
  else bad('أوامر مكرّرة متبقية', JSON.stringify(still));

  if (Array.isArray(global.messageEvHandlers) && global.messageEvHandlers.length > 0)
    ok(`المعالجة التلقائية مسجلة: ${global.messageEvHandlers.length} معالج ✅`);
  else bad('المعالج التلقائي', 'غير مسجل — لن تمسح أي بطاقة!');
}

// ── ٢) الزخرفة مطابقة للأصل حرفياً ──
console.log('\n[2] decoFooter مطابقة لأمر "مراقب" الأصلي');
const { decoFooter } = await import('./accounts/art/utils/deco.js');

const ORIGINAL_LINK =
`🌿 .ৎ˚₊‧ *⏤͟͟͞͞✧尬 ⁽ 🜸 ₎ رابــط الجـروب 🗞️𓏲 ࣪₊*
\`\`\`『 https://chat.whatsapp.com/ABCDE 』\`\`\``;

const gotLink = decoFooter({ groupLink: 'https://chat.whatsapp.com/ABCDE', groupName: 'X' });
if (gotLink === ORIGINAL_LINK) ok('نسخة الرابط مطابقة حرفاً بحرف');
else { bad('نسخة الرابط', JSON.stringify(gotLink)); console.log('    المطلوب:', JSON.stringify(ORIGINAL_LINK)); }

const gotName = decoFooter({ groupName: 'مجموعة الاختبار' });
if (gotName.includes('مجموعة الاختبار') && !gotName.includes('https://'))
  ok('نسخة الطرد: اسم القروب فقط بدون رابط ✅');
else bad('نسخة الطرد', gotName);

// ── ٣) resolvePn: يحوّل lid → رقم حقيقي ويتجاهل الأرقام الوهمية ──
console.log('\n[3] resolvePn (حل @lid)');
const { resolvePn, toPnJid, pureDigits } = await import('./accounts/art/utils/resolvePn.js');

const fakeMeta = {
  subject: 'مجموعة',
  participants: [
    { id: '104806312050733@lid', lid: '104806312050733@lid', phoneNumber: '2135551234@s.whatsapp.net', admin: null },
    { id: '2136669999@s.whatsapp.net', admin: 'admin' },
    { id: '999888777@lid', lid: '999888777@lid' },  // بلا phoneNumber
  ],
};
const fakeSock = { groupMetadata: async () => fakeMeta };

const r1 = await resolvePn(fakeSock, 'g@g.us', '104806312050733@lid');
if (r1 === '2135551234@s.whatsapp.net') ok('lid → رقم صحيح');
else bad('lid → رقم', r1);

const r2 = await resolvePn(fakeSock, 'g@g.us', '999888777@lid');
if (r2 === null) ok('lid بلا phoneNumber → null (ما نخترع رقم) ✅');
else bad('lid بلا phoneNumber', r2);

const r3 = await resolvePn(fakeSock, 'g@g.us', '2136669999@s.whatsapp.net');
if (r3 === '2136669999@s.whatsapp.net') ok('pn يمر كما هو');
else bad('pn', r3);

// الخلل القديم: تحويل lid إلى س.whatsapp.net بالأرقام
if (pureDigits('104806312050733@lid') + '@s.whatsapp.net' !== r1)
  ok('ما نبني pn من gid مباشرة (الخلل القديم مصلوح) ✅');
else bad('ما زال يبني pn من gid!');

// ── safePnJid: الحارس ضد التخمين ──
const { safePnJid } = await import('./accounts/art/utils/resolvePn.js');
if (safePnJid('104806312050733@lid') === null) ok('safePnJid يرفض @lid ✅');
else bad('safePnJid يرفض @lid', safePnJid('104806312050733@lid'));

if (safePnJid('2135551234@s.whatsapp.net') === '2135551234@s.whatsapp.net')
  ok('safePnJid يقبل pn عادي');
else bad('safePnJid pn عادي', safePnJid('2135551234@s.whatsapp.net'));

// خلل ثانٍ كان مخفياً: split(':') يفقد النطاق في الصيغة القديمة
if (safePnJid('2135551234:12@s.whatsapp.net') === '2135551234@s.whatsapp.net')
  ok('الصيغة القديمة 213:12@s.whatsapp.net تُصلح بدون فقد النطاق ✅');
else bad('الصيغة القديمة', safePnJid('2135551234:12@s.whatsapp.net'));

if (safePnJid(null) === null && safePnJid(undefined) === null)
  ok('safePnJid يتعامل مع null/undefined');
else bad('safePnJid null', 'رمى أو أعاد شيئاً');

// resolvePn لازم يعالج نفس الصيغة القديمة
const r4 = await resolvePn(fakeSock, 'g@g.us', '2135551234:12@s.whatsapp.net');
if (r4 === '2135551234@s.whatsapp.net') ok('resolvePn يعالج الصيغة القديمة ✅');
else bad('resolvePn الصيغة القديمة', r4);

// ── buildMention: المنشن الأصلي ──
console.log('\n[3b] buildMention — المنشن الأصلي');
const { buildMention, findParticipant, isLidUser } = await import('./accounts/art/utils/resolvePn.js');

// (١) عضو عنده رقم → نستخدم الرقم (سلوكنا القديم، ما نغيّره)
{
  const m = buildMention({ id: '104806312050733@lid', phoneNumber: '2135551234@s.whatsapp.net' }, '104806312050733@lid');
  if (m.jids.length === 1 && m.jids[0] === '2135551234@s.whatsapp.net')
    ok('عند توفّر الرقم → المنشن بالرقم الحقيقي ✅');
  else bad('بالرقم', JSON.stringify(m.jids));
  if (m.label === '@2135551234') ok('العرض @الأرقام ✅');
  else bad('العرض', m.label);
}

// (٢) ⭐ صاحب يوزر: لا يوجد phoneNumber إطلاقاً
{
  const m = buildMention({ id: '104806312050736@lid', username: 'Ahmed2026' }, '104806312050736@lid');
  if (m.jids.length === 1 && m.jids[0] === '104806312050736@lid')
    ok('صاحب يوزر → المنشن بالمعرّف الأصلي @lid (لم تعد فاضية) ✅');
  else bad('صاحب اليوزر', JSON.stringify(m.jids));
  if (m.label === '@Ahmed2026') ok('العرض باليوزر @Ahmed2026 ✅');
  else bad('عرض اليوزر', m.label);
}

// (٣) لا يوجد عضو ولا رقم → ما نترك المنشن ينهار
{
  const m = buildMention(null, '104806312050799@lid');
  if (Array.isArray(m.jids) && m.jids[0] === '104806312050799@lid')
    ok('بلا بيانات القروب → نرجع المعرّف الخام ✅');
  else bad('fallback', JSON.stringify(m));
}

// (٤) findParticipant يجد الصاحب بالlid وبرقمَه
{
  const p1 = await findParticipant(fakeSock, 'g@g.us', '999888777@lid');
  const p2 = await findParticipant(fakeSock, 'g@g.us', '2135551234@s.whatsapp.net');
  if (p1?.id === '999888777@lid' && p2?.id === '104806312050733@lid')
    ok('findParticipant يبحث بالlid وبالرقم ✅');
  else bad('findParticipant', JSON.stringify([p1?.id, p2?.id]));
}

// (٥) isLidUser يفرّق بين الصيغ
if (isLidUser('1@lid') && !isLidUser('1@s.whatsapp.net') && !isLidUser(null))
  ok('isLidUser دقيق ✅');
else bad('isLidUser', 'فرز خاطئ');

// ── ٤) admin-monitor مسجل معالج ──
console.log('\n[4] معالجات الأحداث');
if (!Array.isArray(global.groupEvHandlers)) bad('groupEvHandlers', 'غير موجود');
else {
  const tags = global.groupEvHandlers.map(h => h.__pluginTag || 'anonymous');
  ok(`groupEvHandlers = ${tags.length}: [${tags.join(', ')}]`);
  if (!tags.includes('raqib')) bad('معالج raqib الانضمام', 'غير مسجل');
  else ok('معالج raqib مسجل');
}

if (!Array.isArray(global.messageEvHandlers)) bad('messageEvHandlers', 'غير موجود');
else {
  const tags = global.messageEvHandlers.map(h => h.__pluginTag || 'anonymous');
  ok(`messageEvHandlers = ${tags.length}: [${tags.join(', ')}]`);
  if (!tags.includes('anti-contact')) bad('معالج anti-contact', 'غير مسجل');
}

// ── ٥) مؤقّت raqib ──
if (global.__raqibTimer && typeof global.__raqibTimer.unref === 'function')
  ok('مؤقّت raqib مسجل و unref ✅');
else bad('مؤقّت raqib', 'غير موجود');

console.log(`\n${fail === 0 ? '🎉 كل الاختبارات نجحت' : `⚠️  ${fail} فشل`}`);
process.exit(fail === 0 ? 0 : 1);
