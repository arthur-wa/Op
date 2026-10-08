// ══════════════════════════════════════════════════════════════
//  utils/memberId.js — معرّف موحّد للأعضاء (رقم حقيقي أو @lid لأصحاب اليوزرات)
//
//  المشكلة: صاحب اليوزر رقمه مخفي (لا phoneNumber) فكانت الملفات
//  ترميه (memberKey/resolvePn = null) فلا يُفحص ولا يُشار إليه.
//  الحل: نستخدم @lid كمعرّف أصلي (يصلح للمنشن ولـ getUSyncDevices).
// ══════════════════════════════════════════════════════════════
import { getCachedGroupMeta, getGroupMeta } from './groupMeta.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

export const digitsOf = j => String(j ?? '').split('@')[0].split(':')[0].replace(/\D/g, '');

const isLidJid = j => typeof j === 'string' && j.endsWith('@lid');
const isPnJid  = j => typeof j === 'string' && (j.endsWith('@s.whatsapp.net') || j.endsWith('@c.us'));

export const toPn  = j => (isPnJid(j)  && digitsOf(j)) ? `${digitsOf(j)}@s.whatsapp.net` : null;
export const toLid = j => (isLidJid(j) && digitsOf(j)) ? `${digitsOf(j)}@lid` : null;

function build(pn, lid) {
    const jid = pn || lid || null;
    const pnD = pn ? digitsOf(pn) : '';
    const lidD = lid ? digitsOf(lid) : '';
    return {
        pn: pn || null,
        lid: lid || null,
        jid,                                   // الأفضل للمنشن والفحص
        key: pnD || (lidD ? `l${lidD}` : null),// مفتاح ثابت (الرقم أولاً للتوافق مع الحالة القديمة)
        aliases: [pnD, lidD ? `l${lidD}` : ''].filter(Boolean),
        digits: [pnD, lidD].filter(Boolean),   // كل الأرقام الممكنة للمقارنة
        label: pnD || lidD || '',              // النص بعد @ في المنشن
    };
}

function merge(a, b) { return build(a.pn || b.pn, a.lid || b.lid); }

/** يقبل string / كائن مشارك / مصفوفة منهما */
export function identify(input) {
    if (Array.isArray(input)) return input.reduce((acc, x) => merge(acc, identify(x)), build(null, null));
    if (!input) return build(null, null);

    const cands = typeof input === 'string'
        ? [input]
        : [input.phoneNumber, input.pn, input.id, input.lid, input.participantAlt, input.participant, input.jid];

    let pn = null, lid = null;
    for (const c of cands) {
        if (!c || typeof c !== 'string') continue;
        pn  = pn  || toPn(c);
        lid = lid || toLid(c);
    }
    return build(pn, lid);
}

function findInMeta(meta, idn) {
    for (const x of (meta?.participants || [])) {
        const xi = identify(x);
        if (xi.digits.some(d => idn.digits.includes(d))) return x;
    }
    return null;
}

/** يكمّل المعرّف (رقم + lid) من بيانات القروب ثم من خريطة lid الداخلية إن وُجدت */
export async function resolveFull(sock, groupId, input, meta) {
    let idn = identify(input);
    if (!idn.jid) return idn;

    if (!(idn.pn && idn.lid) && groupId) {
        let m = meta || getCachedGroupMeta(groupId);
        if (!m) m = await getGroupMeta(sock, groupId).catch(() => null);
        const hit = findInMeta(m, idn);
        if (hit) idn = merge(idn, identify(hit));
    }
    if (!idn.pn && idn.lid) {
        try {
            const r = await sock.signalRepository?.lidMapping?.getPNForLID?.(idn.lid);
            const pn = toPn(String(r || ''));
            if (pn) idn = merge(idn, build(pn, null));
        } catch {}
    }
    return idn;
}

export function findParticipantOf(meta, idn) { return findInMeta(meta, idn); }

export function isBotId(sock, idn) {
    const mine = [digitsOf(sock.user?.id), digitsOf(sock.user?.lid)].filter(Boolean);
    return idn.digits.some(d => mine.includes(d));
}

/** كل أرقام مرسل الرسالة (participant / participantAlt / remoteJidAlt / البوت إن fromMe) */
export function senderDigits(sock, msg) {
    const out = new Set();
    const add = j => { const d = digitsOf(j); if (d) out.add(d); };
    if (msg.key.fromMe) { add(sock.user?.id); add(sock.user?.lid); }
    add(msg.key.participant); add(msg.key.participantAlt);
    add(msg.key.remoteJid);   add(msg.key.remoteJidAlt);
    return out;
}

/**
 * يجلب الأجهزة المرتبطة (device > 0) لقائمة JIDs (رقم أو @lid)
 * مع تأخير تكيّفي وإعادة محاولة عند rate-limit.
 * @returns {{map: Map<string, Set<number>|null>, failed: number}}
 *   map: digits → Set أجهزة، أو null لو فشل الطلب (لا نقارن)
 */
export async function getLinkedDevices(sock, jids, { chunkSize = 35, delay = 600, maxDelay = 4000, onProgress } = {}) {
    const uniq = [...new Map(jids.filter(Boolean).map(j => [digitsOf(j), j])).values()];
    const map = new Map();
    let failed = 0, done = 0, gap = delay;

    for (let i = 0; i < uniq.length; i += chunkSize) {
        const part = uniq.slice(i, i + chunkSize);
        let per = null;

        for (let attempt = 0; attempt < 3 && !per; attempt++) {
            try {
                const devices = await sock.getUSyncDevices(part, false, false);
                per = new Map();
                for (const d of (devices || [])) {
                    if (typeof d?.device !== 'number' || d.device <= 0) continue;
                    const k = digitsOf(d.user);
                    if (!k) continue;
                    if (!per.has(k)) per.set(k, new Set());
                    per.get(k).add(d.device);
                }
            } catch (e) {
                console.error('[USync]', e?.message);
                gap = Math.min(gap * 2, maxDelay);
                await sleep(gap * (attempt + 1));
            }
        }

        for (const j of part) {
            const k = digitsOf(j);
            if (per) map.set(k, per.get(k) || new Set());
            else { map.set(k, null); failed++; }
        }
        if (per && gap > delay) gap = Math.max(delay, Math.floor(gap / 2));

        done += part.length;
        if (onProgress) await onProgress(done, uniq.length);
        if (i + chunkSize < uniq.length) await sleep(gap);
    }
    return { map, failed };
}
