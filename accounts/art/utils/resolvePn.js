// ══════════════════════════════════════════════════════════════
//  resolvePn.js — محوّل معرّفات @lid إلى أرقام واتساب حقيقية
//
//  واتساب قسّم يوزراته (Usernames) فصار كثير من معرّفات الأعضاء
//  داخل القروب بصيغة @lid، والمنشن ما يشتغل إلا بصيغة
//  @s.whatsapp.net  — عشان كذا أي منشن بـ @lid يطلع بدون تفعيل.
//
//  هالملف يحلّها: يرجع الجيد الصح للمنشن مع كاش قصير عشان
//  ما نستدعي groupMetadata كل رسالة.
// ══════════════════════════════════════════════════════════════

import { getGroupMeta, invalidateGroupMeta } from './groupMeta.js';

const pnCache = new Map();   // `${groupId}|${lid}` -> pnJid | null (null = غير قابل للاستخراج)

/** ينزع كل ما ليس رقماً ويرجع الرقم الخام */
export function pureDigits(jid) {
    return String(jid || '').split('@')[0].split(':')[0].replace(/\D/g, '');
}

/** يبني JID واتساب صحيح من رقم — يرجع null إذا ما فيه رقم */
export function toPnJid(value) {
    const n = pureDigits(value);
    return n ? `${n}@s.whatsapp.net` : null;
}

/** هل هالجيد أصلاً بصيغة واتساب الحقيقية؟ */
export function isPnJid(jid) {
    return typeof jid === 'string' && jid.endsWith('@s.whatsapp.net');
}

/**
 * يحوّل إلى pnJid **بأمان** — ما يخمّن أبداً من @lid.
 *
 * هذا هو جذر خلل المنشن: `toPnJid('123@lid')` كان يرجع
 * `123@s.whatsapp.net` وهو رقم شخص آخر (أو رقم غير موجود)，
 * فالمنشن يروح على حد غلط ولا يتفعل أصلاً.
 *
 * @returns {string|null}  null إذا المعرّف lid أو مجهول → لازم resolvePn
 */
export function safePnJid(value) {
    if (!value || typeof value !== 'string') return null;
    if (value.endsWith('@s.whatsapp.net')) return toPnJid(value);
    if (value.endsWith('@lid')) return null;        // لا نخمّن أبداً
    return toPnJid(value);
}

/** هل المعرّف بصيغة lid؟ */
export function isLidUser(jid) {
    return typeof jid === 'string' && jid.endsWith('@lid');
}

/**
 * يبحث عن العضو في بيانات القروب (lid أو pn أو يوزر).
 * الكاش قصير — ما يضرب الشبكة لكل رسالة.
 */
export async function findParticipant(sock, groupId, raw) {
    if (!raw) return null;
    const parts = await getParticipants(sock, groupId);
    if (!parts.length) return null;

    const digits = pureDigits(raw);
    return parts.find(x =>
        x?.id === raw || x?.lid === raw || x?.phoneNumber === raw ||
        (digits && x?.id && pureDigits(x.id) === digits) ||
        (digits && x?.phoneNumber && pureDigits(x.phoneNumber) === digits)
    ) || null;
}

/**
 * ⭐ المنشن "الأصلي" — يبني ما يوضع في `mentions` + ما يُعرض بعد @.
 *
 * الحالتان (هذا هو جذر خلل أصحاب اليوزرات):
 *
 *  ١. **توفّر الرقم الحقيقي** → نستخدمه (سلوكنا الحالي، مثبت أنه يفعّل).
 *  ٢. **ما توفّر** (صاحب يوزر أخفى رقمه: `phoneNumber === undefined`) →
 *     كنا نرجع `mentions = []` → النص يعرض `@<أرقام lid>` **بدون تنبيه!**
 *     الآن نستخدم المعرّف الأصلي `participant.id` بصيغة `@lid` — وهو
 *     بالضبط ما يحطّه واتساب نفسه في `mentionedJid` (Baileys #1683).
 *
 * والعرض: `@username` إن توفّر (كما يعرضه واتساب)، وإلا `@الأرقام`.
 *
 * @param {object|null} participant  من بيانات القروب
 * @param {string} [fallbackRaw]     المعرّف الخام من الرسالة
 * @returns {{jids: string[], label: string, username: string, pn: string|null, native: string|null}}
 */
export function buildMention(participant, fallbackRaw) {
    const p = participant || {};

    // الرقم الحقيقي — نفضّله متى توفر (سلوكنا القديم، ما نغيّره)
    const pn = safePnJid(p.phoneNumber) || safePnJid(fallbackRaw);

    // المعرّف الأصلي كما رجّعته واتساب (pn أو lid حسب وضع المجموعة)
    const native = (isPnJid(p.id) || isLidUser(p.id)) ? p.id
                 : (isLidUser(fallbackRaw) ? fallbackRaw : null);

    // المنشن: الرقم لو توفر، وإلا الأصل — لا نترك المصفوفة فاضية أبداً
    const jids = pn ? [pn] : (native ? [native] : []);

    const username = String(p.username || '').replace(/^@/, '').trim();
    const digits = pureDigits(pn) || pureDigits(native) || pureDigits(fallbackRaw);

    return {
        jids,
        label: username ? `@${username}` : `@${digits}`,
        username,
        pn,
        native,
    };
}

async function getParticipants(sock, groupId) {
    try {
        const meta = await getGroupMeta(sock, groupId);
        return Array.isArray(meta?.participants) ? meta.participants : [];
    } catch (e) {
        return [];
    }
}

/**
 * يحوّل أي معرّف (lid أو pn) إلى JID صالح للمنشن.
 * @returns {Promise<string|null>}  `...@s.whatsapp.net` أو null إذا تعذّر
 */
export async function resolvePn(sock, groupId, jid) {
    if (!jid || typeof jid !== 'string') return null;

    // أصلاً pn (يشمل الصيغة القديمة 123:5@s.whatsapp.net) → ما نحتاج شي
    if (isPnJid(jid)) return toPnJid(jid);

    // أي شي ثاني ما هو lid (نفضّل عدم التخمين لكن نطبّق بأمان)
    if (!jid.endsWith('@lid')) return safePnJid(jid);

    // ── lid: لازم ندور عليه في بيانات القروب ──
    const key = `${groupId}|${jid}`;
    if (pnCache.has(key)) return pnCache.get(key);

    const participants = await getParticipants(sock, groupId);

    const p = participants.find(x =>
        x?.id === jid || x?.lid === jid || x?.lidJid === jid ||
        x?.phoneNumber === jid || x?.pn === jid
    );

    let out = null;
    if (p) {
        // الحقل المخصص phoneNumber (موجود في Baileys الحديث) أولاً
        out = safePnJid(p.phoneNumber) || safePnJid(p.id);
    }

    // ما نخترع رقم من gid — نرجّع null والنص يبقى عادي بدون منشن
    pnCache.set(key, out);
    return out;
}

/**
 * يبني مصفوفة mentions صالحة من قائمة جيده.
 * اللي ما ينحل يُطرد من المصفوفة بس يبقى في النص كنص عادي.
 * @returns {Promise<string[]>}
 */
export async function resolveMentions(sock, groupId, jids) {
    const wanted = [...new Set((jids || []).filter(Boolean))];
    const resolved = await Promise.all(wanted.map(j => resolvePn(sock, groupId, j)));
    return [...new Set(resolved.filter(Boolean))];
}

/** يمسح كاش جروب معيّن (يُستدعى بعد تغيّر إشراف أو عند التحديث) */
export function invalidateGroup(groupId) {
    invalidateGroupMeta(groupId);
    for (const k of pnCache.keys()) {
        if (k.startsWith(`${groupId}|`)) pnCache.delete(k);
    }
}

export default {
    pureDigits, toPnJid, isPnJid, isLidUser, safePnJid, resolvePn, resolveMentions,
    findParticipant, buildMention, invalidateGroup,
};
