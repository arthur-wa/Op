// ══════════════════════════════════════════════════════════════
//  groupMeta.js — كاش بيانات القروب مع تجميع الطلبات
//
//  المشكلة السابقة: كل رسالة "جهة اتصال" كانت تستدعي
//  groupMetadata() = طلب شبكة كامل قبل ما يطرد → بطيء ويتكرر
//
//  الحل هنا:
//   • كاش قصير (10 ثواني) → الرسائل المتتابعة ما تنتظر طلب
//   • تجميع (coalesce) → لو وصلت 10 رسائل بنفس اللحظة
//     يصير طلب واحد بس بدل 10
// ══════════════════════════════════════════════════════════════

const cache = new Map();     // groupId -> { at, meta }
const inflight = new Map();  // groupId -> Promise<meta>

const DEFAULT_TTL = 10_000;

/**
 * يجيب بيانات القروب من الكاش أو من الشبكة (طلب واحد فقط لكل مجموعة متزامنة).
 * @param {object} sock
 * @param {string} groupId
 * @param {{ttl?:number, force?:boolean}} [opts]
 */
export async function getGroupMeta(sock, groupId, { ttl = DEFAULT_TTL, force = false } = {}) {
    if (!groupId) throw new Error('getGroupMeta: groupId مطلوب');

    const hit = cache.get(groupId);
    if (!force && hit && Date.now() - hit.at < ttl) return hit.meta;

    // طلب بنفس المجموعة رايح جاي → نรอ نفس الـ promise
    if (inflight.has(groupId)) return inflight.get(groupId);

    const p = (async () => {
        try {
            const meta = await sock.groupMetadata(groupId);
            if (meta) cache.set(groupId, { at: Date.now(), meta });
            return meta;
        } catch (err) {
            // نرجّع القديم بدل ما نفشل — أحسن من إبطاء الطرد
            if (hit) return hit.meta;
            throw err;
        } finally {
            inflight.delete(groupId);
        }
    })();

    inflight.set(groupId, p);
    return p;
}

/**
 * يرجع بيانات القروب من الكاش فقط — بدون أي انتظار.
 * @returns {object|null}  null إذا الكاش بارد (الاستدعاء يستدعي getGroupMeta)
 */
export function getCachedGroupMeta(groupId) {
    const hit = cache.get(groupId);
    if (!hit) return null;
    // نحترم نفس مهلة الكاش بالضبط — ما نبي نقول "أدمن" عن مشرف اُعتاد قبل شوي
    if (Date.now() - hit.at > DEFAULT_TTL) return null;
    return hit.meta;
}

/**
 * مجموعات الأدمن الحالية (مجموعة خفيفة للبحث السريع).
 * @returns {Promise<{admins:Set<string>, pns:Set<string>, participants:Array}>}
 */
export async function getAdminSet(sock, groupId, opts) {
    const meta = await getGroupMeta(sock, groupId, opts);
    const participants = Array.isArray(meta?.participants) ? meta.participants : [];

    const admins = new Set();
    const pns = new Set();

    for (const p of participants) {
        if (!p) continue;
        if (p.admin) {
            if (p.id) admins.add(p.id);
            if (p.lid) admins.add(p.lid);
            if (p.phoneNumber) admins.add(p.phoneNumber);
        }
        // كل الأرقام الخام بغض النظر عن الإشراف (للمطابقة السريعة)
        if (p.id) pns.add(p.id.split(':')[0]);
        if (p.phoneNumber) pns.add(p.phoneNumber.split(':')[0]);
        if (p.lid) pns.add(p.lid);
    }

    return { admins, pns, participants, subject: meta?.subject };
}

/** يمسح كاش مجموعة (يُستدعى بعد تغيّر إشراف ليبقى دقيقاً) */
export function invalidateGroupMeta(groupId) {
    cache.delete(groupId);
}

export default { getGroupMeta, getAdminSet, invalidateGroupMeta };
