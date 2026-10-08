// ══════════════════════════════════════════════════════════════
//  deco.js — زخرفة الإشعارات الموحّدة
//  نفس زخرفة أمر "مراقب" حرفاً بحرف، مع فرق بسيط:
//    • فيه groupLink → سطر يعرض الرابط   (ترقية / سحب إشراف / انضمام)
//    • بدون link     → السطر يعرض اسم القروب فقط (طرد)
// ══════════════════════════════════════════════════════════════

const PREFIX = '🌿 .ৎ˚₊‧ ';
const LINK_LABEL = 'رابــط الجـروب';
const NAME_LABEL = 'اســم الجـروب';

/**
 * يبني آخر سطر من الرسالة (الزخرفة).
 * @param {object} o
 * @param {string} [o.groupLink]  رابط الدعوة — لو انحط يظهر مكانه
 * @param {string} [o.groupName]  اسم القروب — لو ما في رابط يظهر مكانه
 * @param {string} [o.label]      نص عنوان الزخرفة (اختياري)
 */
export function decoFooter({ groupLink, groupName, label } = {}) {
    const useLink = Boolean(groupLink);
    const title = label || (useLink ? LINK_LABEL : NAME_LABEL);
    const body = (useLink ? groupLink : groupName) || '';

    return `${PREFIX}*⏤͟͟͞͞✧尬 ⁽ 🜸 ₎ ${title} 🗞️𓏲 ࣪₊*\n\`\`\`『 ${body} 』\`\`\``;
}

/**
 * يبني سطر الحالة العلوي (Emoji + عنوان الحدث) — بدون الزخرفة.
 */
export function eventLine(emoji, label) {
    return `${emoji} ${label}`;
}

// ══ زخرفة البوت — للانضمام ومسح جهة الاتصال ══
// (أمر "مراقب" يبقى على زخرفته الأصلية كما هي)
const BOT_HEAD = '*𓄲 ╏ 𝙿𝚛𝚘𝚝𝚎𝚌𝚝𝚒𝚘𝚗 :*';
const BOT_DIV  = '*⎔⋅• ━ ╼╃ ⌬〔 🌟 〕⌬ ╄╾ ━ •⋅⎔*';
const BOT_SIGN = '> ⪼ ᑲᥡ 𝙰𝚛𝚝𝚑𝚞𝚛';

/** سطر المنشن: `*👤 「 @213... 」⤹*  ← انـضـم لـلـتـو` (يقبل label يبدأ بـ @) */
export function mentionLine(num, action) {
    const raw = String(num ?? '');
    const at = raw.startsWith('@') ? raw : `@${raw}`;
    return `*👤 「 ${at} 」⤹*  ← ${action || ''}`.trimEnd();
}

/** سطر الأجهزة: `🔌 الأجهزة : 4 أجـهـزة مـرتـبـطـة` (مع لفّة صحيحة للمفرد والمثنى) */
export function devicesLine(count, prev) {
    const n = Number(count) || 0;
    const label = n === 1 ? '1 جـهـاز مـرتـبـط'
                : n === 2 ? '2 جـهـزان مـرتـبـطان'
                : `${n} أجـهـزة مـرتـبـطـة`;

    if (prev === undefined || prev === null) return `🔌 الأجهزة : ${label}`;
    return `🔌 الأجهزة : ${Number(prev) || 0} ← ${label}`;
}

/** سطر الرابط: `🔗 *『 https://... 』*` */
export function linkLine(link) {
    return `🔗 *『 ${link} 』*`;
}

/** `*🕒 6‏/10‏/2026 ⪼ 17:32:45*` */
export function nowStamp(d = new Date()) {
    const date = d.toLocaleDateString('ar-DZ');
    const time = d.toLocaleTimeString('ar-DZ', { hour12: false });
    return `*🕒 ${date} ⪼ ${time}*`;
}

/**
 * زخرفة البوت — مخطّطة بماركدون واتساب (نجمة = غامق، > = اقتباس).
 * سطر التوقيت آخر سطر بالضبط كما في القالب.
 *
 * @param {object} o
 * @param {string} o.groupName  اسم القروب
 * @param {string} o.status     سطر "الحالة" (ما حدث)
 * @param {string} [o.body]     المحتوى (mentionLine + devicesLine + linkLine)
 * @param {string} [o.stamp]    سطر التوقيت — افتراضياً الآن
 */
export function botNotice({ groupName, status, body = '', stamp } = {}) {
    const lines = [
        BOT_HEAD,
        '',
        BOT_DIV,
        '',
        `*⌗˖￤اسـم الـجـروب⬿『 ${groupName || '—'} 』*`,
        `*⌗˖￤الـحـالـة⬿『 ${status || '—'} 』*`,
    ];

    if (body) lines.push('', body);

    lines.push('', BOT_DIV, BOT_SIGN, stamp || nowStamp());

    return lines.join('\n');
}

export default {
    decoFooter, eventLine, botNotice,
    mentionLine, devicesLine, linkLine, nowStamp,
    LINK_LABEL, NAME_LABEL,
};
