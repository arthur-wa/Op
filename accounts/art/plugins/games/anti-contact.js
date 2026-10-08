// ══════════════════════════════════════════════════════════════
//  anti-contact.js — "مسح الجهات" : يحذف أي بطاقة جهة اتصال
//  ويطرد مرسلها إذا ما كان أونر/أدمن + يرسل إشعار بالمنشن
//
//  ✅ يعمل تلقائيًا بدون أمر (عبر global.messageEvHandlers)
//  ✅ الحذف يشمل الجميع بلا استثناء (حتى الأونر/الأدمن)
//  ✅ الطرد مستثنى للأونر والأدمنية فقط
//  ✅ خالٍ من await قبل الحذف — الحذف يصير فوراً في أول خطوة
//
//  ══ تحسينات السرعة ══
//  ١. كاش groupMeta مشترك → ما فيه طلب شبكة لكل رسالة (كان السبب
//     الأساسي للبطء: طلب كامل قبل كل طرد)
//  ٢. استيراد static لـ config → كان await import() في كل رسالة
//     (وسوء مسار: '../nova/config.js' ما كان موجود → الاستثناءات تفشل)
//  ٣. طرد واحد لكل عضو خلال فترة التهدئة → السبام لا يركّب طابور طرود
//  ٤. فاصل الطرد نزل 1200ms → KICK_GAP_MS مع تكيّف تلقائي
//     لو واتساب رجّعت rate-limit نعيد التهدئة بدل ما نخسر الطلبات
//  ٥. ⭐ **طرد مجمّع**: كل الطرود داخل نافذة KICK_BATCH_MS تُرسل
//     **بطلب شبكة واحد** بدل طلب لكل بطاقة.
//     10 بطاقات من 10 أعضاء = 10 طلبات × 400ms (≈4 ثوانٍ)
//                      ← صارت **طلب واحد** + فاصل 250ms
//
//  ══ دقة ══
//  • المرسل يُفضَّل participantAlt (رقم PN حقيقي) ثم participant (lid)
//  • الطرد يستخدم المعرّف القيمي من بيانات القروب بدل المعرّف الخام
//  • ⭐ **المنشن الأصلي** (utils/resolvePn.buildMention):
//      - عنده رقم → نشير بالرقم (كما كان، مثبت أنه يفعّل)
//      - **صاحب يوزر (رقمه مخفي، phoneNumber = undefined)** → كنا نرجع
//        مصفوفة منشن **فارغة**: النص يعرض أرقام lid بدون أي تنبيه!
//        الآن نشير بالمعرّف الأصلي @lid — وهو بالضبط ما يضعه واتساب
//        نفسه في mentionedJid — والنص يعرض @اليوزر إن توفّر
// ══════════════════════════════════════════════════════════════

import config from '../../nova/config.js';
import { getGroupMeta, getCachedGroupMeta } from '../../utils/groupMeta.js';
import { pureDigits } from '../../utils/resolvePn.js';
import { identify, resolveFull, findParticipantOf, isBotId } from '../../utils/memberId.js';
import { botNotice, mentionLine, linkLine } from '../../utils/deco.js';
import { markNoticed } from '../../utils/noticeMark.js';
import { sendNotify } from '../../utils/notifyRouter.js';

const NovaUltra = {
    // بلا أوامر بريفيكس — "مسح الجهات" تعمل تلقائياً على أي بطاقة
    // (request: الأوامر المكرّرة مالها فايدة)
    command: [],
    description: 'حذف بطاقاتجهات الاتصال وطرد مرسلها + إشعار بالمنشن',
    elite:       'off',
    group:       true,
    prv:         false,
    lock:        'off',
};

// ⚙️ إعدادات قابلة للتعديل
const EXEMPT_OWNER  = true;  // الأونر معفي من الطرد فقط (الحذف يشمله دائمًا)
const EXEMPT_ADMINS = true;  // أدمنية القروب معفيون من الطرد فقط (الحذف يشملهم دائمًا)

const KICK_GAP_MS   = 250;    // الفاصل بين مجمّعة طرود وأخرى (كان 400، وكان 1200)
const KICK_BATCH_MS = 100;    // نافذة تجميع الطرود قبل إرسال طلب واحد
const KICK_BATCH_MAX = 50;    // أقصى طرد في المجمّعة الواحدة
const MAX_GAP_MS    = 4000;   // سقف التهدئة عند rate-limit
const KICK_COOLDOWN = 15_000; // ما نعيد طرد نفس العضو خلال 15 ثانية
const ANN_COOLDOWN  = 15_000; // ما نعيد إشعار نفس العضو خلال 15 ثانية

const OWNER_NUMBER = pureDigits(config.owner || '');

function isContactMessage(msg) {
    const m = msg.message;
    return !!(m && (m.contactMessage || m.contactsArrayMessage));
}

// ── طابور طرد **مجمّع** لكل قروب ──
// التحسين الأكبر للسرعة: بدل طلب شبكة لكل بطاقة (+ فاصل 400ms)،
// نجمع كل الطرود خلال نافذة قصيرة ونرسلها **بطلب واحد**.
// مثال: 50 بطاقة = 50×400ms (≈20 ثانية) ← صارت طلب واحد + فاصل واحد.
const kickQueues  = new Map();   // chatId -> Promise chain (يمنع تزامن المجمّعات)
const pendingKicks = new Map();  // chatId -> Map<key, {senderRaw, senderPure}>
const kickTimers  = new Map();   // chatId -> timeout
const groupGap    = new Map();   // chatId -> الفاصل الحالي (تكيّف)
const lastKick    = new Map();   // `${chatId}|${pure}` -> ts
const lastAnn     = new Map();   // `${chatId}|${pure}` -> ts

const delay = ms => new Promise(r => setTimeout(r, ms));

const getGap = chatId => groupGap.get(chatId) || KICK_GAP_MS;

function isRateLimit(err) {
    const s = String(err?.message || err || '');
    return /429|rate[- ]?limit|too many|overloaded|retry later/i.test(s)
        || err?.output?.statusCode === 429;
}

/** يضاعف الفاصل مؤقتاً لو واتساب رجّعت rate-limit */
function bumpGap(chatId) {
    groupGap.set(chatId, Math.min(getGap(chatId) * 2, MAX_GAP_MS));
}

function relaxGap(chatId) {
    const g = getGap(chatId);
    if (g > KICK_GAP_MS) groupGap.set(chatId, Math.max(KICK_GAP_MS, Math.floor(g / 2)));
}

function enqueueKick(chatId, task) {
    const prev = kickQueues.get(chatId) || Promise.resolve();
    const next = prev
        .then(async () => {
            await task();
            await delay(getGap(chatId));
        })
        .catch(() => {})
        .finally(() => {
            if (kickQueues.get(chatId) === next) kickQueues.delete(chatId);
        });
    kickQueues.set(chatId, next);
    return next;
}

/**
 * يجدول طرداً ضمن مجمّعة القروب — ينفجر (flush) بعد KICK_BATCH_MS
 * أو فور بلوغ KICK_BATCH_MAX، فيصير طلب شبكة واحد للجميع.
 */
function scheduleKick(sock, chatId, senderRaw, idn) {
    const key = `${chatId}|${idn.key || senderRaw}`;

    let bucket = pendingKicks.get(chatId);
    if (!bucket) { bucket = new Map(); pendingKicks.set(chatId, bucket); }
    bucket.set(key, { senderRaw, idn });

    if (bucket.size >= KICK_BATCH_MAX) { void flushKicks(sock, chatId); return; }
    if (kickTimers.has(chatId)) return;

    const t = setTimeout(() => {
        kickTimers.delete(chatId);
        void flushKicks(sock, chatId);
    }, KICK_BATCH_MS);
    t.unref?.();
    kickTimers.set(chatId, t);
}

/** يرسل كل الطرود المجمّعة **بطلب واحد** */
async function flushKicks(sock, chatId) {
    const timer = kickTimers.get(chatId);
    if (timer) { clearTimeout(timer); kickTimers.delete(chatId); }

    const bucket = pendingKicks.get(chatId);
    if (!bucket || !bucket.size) return;
    pendingKicks.delete(chatId);

    const entries = [...bucket.values()];

    await enqueueKick(chatId, async () => {
        try {
            const meta = getCachedGroupMeta(chatId) || await getGroupMeta(sock, chatId).catch(() => null);
            const ids = [...new Set(entries.map(e => canonicalKickId(meta, e.senderRaw, e.idn)))];
            if (!ids.length) return;

            const res = await sock.groupParticipantsUpdate(chatId, ids, 'remove'); // ← طلب واحد
            stats.kicked += ids.length - failedCount(res);

            const failed = failedCount(res);
            if (failed) console.log(`[anti-contact] ⚠️ فشل طرد ${failed}/${ids.length} (مجمّعة)`);

            relaxGap(chatId);
        } catch (err) {
            if (isRateLimit(err)) {
                bumpGap(chatId);
            } else if (String(err).includes('401') || String(err).includes('not a group admin')) {
                console.log('[anti-contact] ⚠️ البوت ليس مشرفاً لطرد العضو.');
            } else {
                console.log(`[anti-contact] ⚠️ فشل طرد مجمّعة (${entries.length}): ${String(err).slice(0, 120)}`);
            }
        }
    });
}

/** Baileys يرجع مصفوفة نتائج لكل مشارك — نعدّ الفاشل منها */
function failedCount(res) {
    if (!Array.isArray(res)) return 0;
    return res.filter(r => r && r.status && r.status !== 200).length;
}

/**
 * هل العضو أونر/أدمن؟ يطابق بالرقم أو بالـ lid (أصحاب اليوزرات).
 * يرجع 'unknown' لو تعذّر جلب بيانات القروب → ما نطرد (أأمن).
 */
async function getExemption(sock, chatId, idn) {
    if (isBotId(sock, idn)) return 'owner';
    if (EXEMPT_OWNER && OWNER_NUMBER && idn.digits.includes(OWNER_NUMBER)) return 'owner';
    if (!EXEMPT_ADMINS) return null;

    let meta = getCachedGroupMeta(chatId);
    if (!meta) {
        try { meta = await getGroupMeta(sock, chatId); }
        catch (e) { return 'unknown'; }
    }
    if (!meta?.participants) return 'unknown';

    const p = findParticipantOf(meta, idn);
    if (p?.admin) return 'admin';

    // الأونر قد يكون lid في القروب ورقمه في الإعدادات
    if (EXEMPT_OWNER && OWNER_NUMBER && p) {
        if (identify(p).digits.includes(OWNER_NUMBER)) return 'owner';
    }
    return null;
}

/** المعرّف القيمي للطرد من بيانات القروب (lid أو pn حسب وضع المجموعة) */
function canonicalKickId(meta, senderRaw, idn) {
    const p = findParticipantOf(meta, idn);
    return p?.id || idn.lid || idn.pn || senderRaw;
}

async function handler(sock, msg) {
    if (!isContactMessage(msg)) return;

    const chatId = msg.key.remoteJid;
    if (!chatId?.endsWith('@g.us')) return; // القروبات فقط

    // ── ١) الحذف: فوراً وللجميع — بدون أي انتظار أو طلب شبكة ──
    const senderRaw = msg.key.fromMe
        ? (sock.user?.id || chatId)
        : (msg.key.participant || msg.key.participantAlt || chatId);
    const senderPure = pureDigits(senderRaw);

    sock.sendMessage(chatId, {
        delete: {
            remoteJid: chatId,
            id: msg.key.id,
            participant: senderRaw,
            fromMe: msg.key.fromMe === true,
        },
    }).catch(() => {});
    stats.deleted++;

    if (!senderPure) return;

    // معرّف موحّد (رقم + lid إن وُجدا) — participantAlt = رقم حقيقي
    const idn = await resolveFull(sock, chatId, [msg.key.participantAlt, senderRaw].filter(Boolean));
    if (!idn.jid) return;

    // ── ٢) الاستثناء (أونر/أدمن) ──
    const exemption = await getExemption(sock, chatId, idn);
    if (exemption === 'unknown') return;   // تعذّر التحقق → حذفنا البطاقة فقط
    if (exemption) {
        announce(sock, chatId, { idn, kicked: false, reason: exemption }).catch(() => {});
        return;
    }

    // ── ٣) الطرد (طابور + تهدئة تكيّفية) ──
    const kickKey = `${chatId}|${idn.key}`;
    const alreadyKicked = Date.now() - (lastKick.get(kickKey) || 0) < KICK_COOLDOWN;

    // نعلّم كل صيغ العضو (رقم و lid) كي ما يكرر admin-monitor الإشعار
    const pnD  = idn.pn  ? pureDigits(idn.pn)  : null;
    const lidD = idn.lid ? pureDigits(idn.lid) : null;
    markNoticed(chatId, lidD || senderPure, pnD || senderPure);
    markNoticed(chatId, senderPure, pnD || lidD || senderPure);

    if (!alreadyKicked) {
        lastKick.set(kickKey, Date.now());
        scheduleKick(sock, chatId, senderRaw, idn);
    }

    // ── ٤) الإشعار (لا ينتظر — الحذف أهم) ──
    announce(sock, chatId, { idn, kicked: true }).catch(() => {});
}

/**
 * يرسل إشعار الحذف/الطرد إلى NOTIFY_JID (نفس مجموعة admin-monitor)
 * بزخرفة البوت botNotice — مع رابط القروب والتوقيت تحت.
 */
async function announce(sock, chatId, { idn, kicked, reason }) {
    const annKey = `${chatId}|${idn.key}`;
    if (Date.now() - (lastAnn.get(annKey) || 0) < ANN_COOLDOWN) return;
    lastAnn.set(annKey, Date.now());

    try {
        // المنشن: الرقم إن توفّر، وإلا @lid الأصلي لصاحب اليوزر (والنص @<lid> يتحوّل لاسمه)
        const mentions = [idn.jid];
        const targetNum = idn.label;

        let groupName = chatId;
        try {
            const meta = getCachedGroupMeta(chatId) || await getGroupMeta(sock, chatId);
            groupName = meta?.subject || chatId;
        } catch {}

        let link = null;
        try {
            const code = await sock.groupInviteCode(chatId);
            if (code) link = `https://chat.whatsapp.com/${code}`;
        } catch {}

        const status = kicked
            ? 'حـذف بـطـاقـة جـهـة اتـصـال + طـرد ⚠️'
            : 'حـذف بـطـاقـة جـهـة اتـصـال';

        const detail = kicked
            ? 'تم حذف البطاقة وطرده من القروب'
            : (reason === 'owner' ? 'أونر — حُذفت البطاقة فقط (معفى من الطرد)'
                                  : 'أدمن — حُذفت البطاقة فقط (معفى من الطرد)');

        const body = [
            mentionLine(targetNum, detail),
            link ? linkLine(link) : '',
        ].filter(Boolean).join('\n');

        await sendNotify(sock, chatId, { text: botNotice({ groupName, status, body }), mentions });
    } catch (e) {
        console.error('[anti-contact] announce error:', e?.message);
    }
}

// تسجيل الهاندلر تلقائيًا عند تحميل البلوجن (يصمد أمام إعادة التحميل عبر أمر "حدث")
if (!global.messageEvHandlers) global.messageEvHandlers = [];
global.messageEvHandlers = global.messageEvHandlers.filter(h => h.__pluginTag !== 'anti-contact');
handler.__pluginTag = 'anti-contact';
global.messageEvHandlers.push(handler);

// إحصائية حية للأمر
const stats = { deleted: 0, kicked: 0 };

async function execute({ sock, msg }) {
    const chatId = msg.key.remoteJid;

    let groupName = chatId;
    let size = '?';
    let botAdmin = false;
    try {
        const meta = await getGroupMeta(sock, chatId, { force: true });
        groupName = meta?.subject || chatId;
        size = meta?.participants?.length ?? '?';
        botAdmin = (meta?.participants || []).some(p => p?.admin && isBotId(sock, identify(p)));
    } catch {}

    await sock.sendMessage(chatId, {
        text:
`🗑️ مسح الجهات

📌 القروب     : ${groupName}
👥 الأعضاء    : ${size}
👮 صلاحية البوت: ${botAdmin ? 'مشرف ✅' : 'ليس مشرف ⚠️ (ما يقدر يطرد)'}
🗑️ محذوفات    : ${stats.deleted}
👢 طرود       : ${stats.kicked}

⚙️ الفاصل الحالي : ${KICK_GAP_MS}ms (يتأقلم تلقائياً)
⚡ التجميع        : ${KICK_BATCH_MS}ms / حتى ${KICK_BATCH_MAX} طرد بطلب واحد
✅ الحذف يشمل الجميع / الطرد يعفي الأونر والأدمن`,
    }, { quoted: msg });
}

export default { NovaUltra, execute };
