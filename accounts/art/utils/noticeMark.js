// ══════════════════════════════════════════════════════════════
//  noticeMark.js — علامة "تم إشعار هذا الطرد مسبقاً"
//  تمنع تكرار الرسالة لما أكثر من بلوجن يمسك نفس الحدث.
//  (anti-contact يرسل إشعار البطاقة، فـ admin-monitor ما يعيد)
//
//  ✅ تقبل أسماء متعددة (aliases) لأن نفس العضو يظهر بمعرّفين:
//     `104806312050733@lid` (أرقام الـ gid) و `2135551234` (رقمه)
//     — بدون هذا تفشل الفلترة بين البلوجينات
//
//  مهم: هذا الملف utils عادي → الكاش عند Node واحد للجميع،
//  عكس البلوجينات اللي تُعاد تحميلها بـ ?update= كل مرة.
// ══════════════════════════════════════════════════════════════

const marks = new Map(); // `${groupId}|${alias}` -> expiresAt
const TTL = 15_000;

let sweeper = null;

function ensureSweeper() {
    if (sweeper) return;
    sweeper = setInterval(() => {
        const now = Date.now();
        for (const [k, exp] of marks) if (now > exp) marks.delete(k);
    }, 60_000);
    sweeper.unref?.();
}

const uniq = keys => [...new Set((keys || []).filter(Boolean).map(String))];

/** يعلّم أن هالشخص أُعلن عنه للتو (يمنع تكرار الإشعار) */
export function markNoticed(groupId, ...keys) {
    const aliases = uniq(keys);
    if (!groupId || !aliases.length) return;
    ensureSweeper();
    const exp = Date.now() + TTL;
    for (const a of aliases) marks.set(`${groupId}|${a}`, exp);
}

/** هل أُعلن عنه خلال فترة الصلاحية؟ (أي مفتاح يكفي) */
export function wasNoticed(groupId, ...keys) {
    const aliases = uniq(keys);
    if (!groupId || !aliases.length) return false;
    const now = Date.now();
    let hit = false;

    for (const a of aliases) {
        const k = `${groupId}|${a}`;
        const exp = marks.get(k);
        if (!exp) continue;
        if (now > exp) { marks.delete(k); continue; }
        hit = true;
    }
    return hit;
}

export default { markNoticed, wasNoticed };
