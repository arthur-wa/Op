// ══════════════════════════════════════════════════════════════
//  raqib.js — أمر ".راقب" : مراقب الأعضاء والأجهزة
//
//  ✅ فحص تلقائي كل 5 دقائق لكل قروبات البوت
//  ✅ **كل الإشعارات تذهب إلى NOTIFY_JID** — قروب واحد فقط
//     (نفس قروب admin-monitor "مراقبة الاشرافات")
//  ✅ لا إشعار انضمام "عمياني" — الانضمام يمرّ عبر فحص الأجهزة
//     (نفس منطق أمر "فحص") ولا يُرسل إلا لو معه أجهزة مرتبطة:
//      ١. عضو انضم ومعه جهاز مرتبط → إشعار برابط القروب + منشن
//      ٢. عضو حديث ربط جهازاً بعد انضمامه → إشعار بزيادة العدد
//  ✅ زخرفة البوت (botNotice) بماركدون واتساب + التوقيت أسفل الرسالة
//     — أما إشعارات "مراقب" فتبقى على زخرفتها الأصلية كما هي
//  ✅ الحالة محفوظة في ملف → بعد إعادة تشغيل البوت
//     ما يعيد إعلان القديم كأنه جديد
//  ✅ أول فحص لكل قروب = قاعدة مرجعية (يتسجيل الأعضاء بدون إعلان)
//  ✅ يدعم أصحاب اليوزرات (رقمهم مخفي) عبر @lid في الفحص والمنشن
//  ✅ كشف فوري لحظ انضمام العضو، مدموج مع الفحص الدوري بدون تكرار
// ══════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';

import { getGroupMeta } from '../../utils/groupMeta.js';
import { identify, resolveFull, isBotId, getLinkedDevices, digitsOf } from '../../utils/memberId.js';
import { botNotice, mentionLine, devicesLine, linkLine } from '../../utils/deco.js';
import { NOTIFY_JID } from '../../utils/notifyJid.js';
import { sendNotify } from '../../utils/notifyRouter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR  = path.join(__dirname, '../../nova/data');
const DATA_FILE = path.join(DATA_DIR, 'raqib.json');

// ⚙️ إعدادات
const SCAN_INTERVAL_MS = 5 * 60 * 1000;        // كل 5 دقائق
const DEVICE_WATCH_MS  = 12 * 60 * 60 * 1000;  // نراقب أجهزة من انضم خلال 12 ساعة
const LINK_TTL_MS      = 30 * 60 * 1000;        // كاش رابط القروب (نصف ساعة)
const CHUNK_SIZE  = 35;
const CHUNK_DELAY = 600;
const GROUP_DELAY = 1500;   // تهدئة بين فحص كل قروب

const sleep = ms => new Promise(r => setTimeout(r, ms));
const chunk = (arr, size) => Array.from(
    { length: Math.ceil(arr.length / size) },
    (_, i) => arr.slice(i * size, i * size + size)
);

// ── الحالة (محفوظة على القرص) ──
let state = { groups: {} };
if (!state.groups) state.groups = {};

function loadState() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
            if (raw && typeof raw === 'object' && raw.groups) state = raw;
        }
    } catch (e) {
        console.error('[raqib] تعذّر قراءة الحالة:', e.message);
    }
    if (!state.groups) state.groups = {};
}
loadState();

let saveTimer = null;
function saveState(immediate = false) {
    const write = () => {
        try {
            fs.mkdirSync(DATA_DIR, { recursive: true });
            fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2), 'utf8');
        } catch (e) {
            console.error('[raqib] تعذّر حفظ الحالة:', e.message);
        }
    };
    clearTimeout(saveTimer);
    if (immediate) return write();
    saveTimer = setTimeout(write, 2000);
}

function grp(groupId) {
    if (!state.groups[groupId]) {
        state.groups[groupId] = { name: groupId, baseline: false, lastScan: 0, link: null, linkAt: 0, members: {} };
    }
    if (!state.groups[groupId].members) state.groups[groupId].members = {};
    return state.groups[groupId];
}

/** يلقى سجل العضو الموجود (بالرقم أو بالـ lid) — يمنع تسجيل الشخص مرتين */
function findKey(g, idn) {
    for (const a of idn.aliases) if (g.members[a]) return a;
    for (const [k, r] of Object.entries(g.members)) {
        if (idn.pn && r.pn === idn.pn) return k;
        if (idn.lid && r.lid === idn.lid) return k;
    }
    return null;
}

/** JID الفحص/المنشن للسجل: الرقم أولاً وإلا الـ lid (أصحاب اليوزرات) */
const recJid = rec => rec?.pn || rec?.lid || null;

/** يحدّث الرقم/الـ lid لو انكشف أحدهما لاحقاً */
function refreshRec(rec, idn) {
    if (idn.pn && !rec.pn) rec.pn = idn.pn;
    if (idn.lid && !rec.lid) rec.lid = idn.lid;
}

async function getGroupLink(sock, groupId) {
    const g = grp(groupId);
    if (g.link && Date.now() - (g.linkAt || 0) < LINK_TTL_MS) return g.link;

    let link = null;
    try {
        const code = await sock.groupInviteCode(groupId);
        if (code) link = `https://chat.whatsapp.com/${code}`;
    } catch {
        try {
            const info = await sock.groupInviteInfo(groupId);
            if (info?.inviteCode) link = `https://chat.whatsapp.com/${info.inviteCode}`;
        } catch {}
    }
    if (link) { g.link = link; g.linkAt = Date.now(); }
    return link;
}

/** عدد الأجهزة المرتبطة لكل JID (رقم أو lid) — Map: digits → عدد | null لو فشل */
async function fetchDeviceCounts(sock, jids) {
    const { map } = await getLinkedDevices(sock, jids, { chunkSize: CHUNK_SIZE, delay: CHUNK_DELAY });
    const res = new Map();
    for (const [k, set] of map) res.set(k, set === null ? null : set.size);
    return res;
}

/**
 * يرسل إشعاراً بزخرفة البوت (botNotice) — **دائماً إلى NOTIFY_JID**
 * (كل إشعارات البوت تعتمد على قروب واحد)، والتوقيت في الأسفل.
 */
async function sendNotice(sock, groupId, { status, body, mentions, groupName }) {
    const text = botNotice({ groupName, status, body });

    await sendNotify(sock, groupId, {
        text,
        mentions: (mentions || []).filter(Boolean),
    });
}


/**
 * يفحص القروبات ويعلن الجديد فقط.
 * @param {{announce?:boolean}} [opts] announce=false → تسجيل فقط بدون إعلان
 */
async function scan(sock, targetGroups, { announce = true } = {}) {
    const results = { joins: 0, deviceNotices: 0, groups: 0, baseline: 0 };
    if (!sock) return results;

    for (let gi = 0; gi < targetGroups.length; gi++) {
        const groupId = targetGroups[gi];
        if (gi > 0) await sleep(GROUP_DELAY);   // تهدئة بين القروبات (يمنع rate-limit على groupMetadata)

        try {
            const meta = await getGroupMeta(sock, groupId, { force: true });
            if (!meta?.participants) continue;

            results.groups++;
            const g = grp(groupId);
            const groupName = meta.subject || groupId;
            g.name = groupName;
            const ts = Date.now();

            // ── الأعضاء الحاليون (رقم أو lid — أصحاب اليوزرات يُحسبون) ──
            const currentKeys = new Set();
            const keyToIdn = new Map();
            for (const p of meta.participants) {
                const idn = identify(p);
                if (!idn.jid || isBotId(sock, idn)) continue;
                const k = findKey(g, idn) || idn.key;
                currentKeys.add(k);
                keyToIdn.set(k, idn);
            }

            // ── أول فحص = قاعدة مرجعية ──
            if (!g.baseline) {
                for (const k of currentKeys) {
                    if (g.members[k]) continue;
                    const idn = keyToIdn.get(k);
                    g.members[k] = { joinedAt: ts, devices: null, notified: true, pn: idn.pn, lid: idn.lid };
                }
                g.baseline = true;
                g.lastScan = ts;
                results.baseline++;
                saveState();
                continue;
            }

            // ── جدد + معلّقين (فشل فحصهم سابقاً) ──
            const todo = [];
            for (const k of currentKeys) {
                const idn = keyToIdn.get(k);
                let rec = g.members[k];
                if (!rec) {
                    rec = g.members[k] = { joinedAt: ts, devices: null, notified: false, tries: 0, pn: idn.pn, lid: idn.lid };
                    todo.push(k);
                } else {
                    refreshRec(rec, idn);
                    if (rec.notified === false) todo.push(k);   // محاولة سابقة فشلت
                }
            }

            // ── خرجوا من القروب ──
            for (const k of Object.keys(g.members)) {
                if (!currentKeys.has(k)) delete g.members[k];
            }
            g.lastScan = ts;

            if (!announce) {
                for (const k of todo) g.members[k].notified = true;
                saveState();
                continue;
            }

            // ── ١) إعلان المنضمين الجدد (من معه أجهزة مرتبطة فقط) ──
            if (todo.length) {
                const counts = await fetchDeviceCounts(sock, todo.map(k => recJid(g.members[k])));
                let link = null;

                for (const k of todo) {
                    const rec = g.members[k];
                    const jid = recJid(rec);
                    const devs = counts.get(digitsOf(jid));

                    if (devs === null || devs === undefined) {          // فشل الطلب → نعيد بالدورة القادمة
                        rec.tries = (rec.tries || 0) + 1;
                        if (rec.tries >= 3) rec.notified = true;
                        continue;
                    }
                    rec.devices = devs;
                    rec.notified = true;
                    if (devs <= 0) continue;

                    results.joins++;
                    if (link === null) link = await getGroupLink(sock, groupId);
                    const body = [
                        mentionLine(digitsOf(jid), 'انـضـم لـلـتـو'),
                        devicesLine(devs),
                        link ? linkLine(link) : '',
                    ].filter(Boolean).join('\n');

                    await sendNotice(sock, groupId, {
                        status: 'عـضـو جـديـد رابـط جـهـاز ⚠️',
                        body, mentions: [jid], groupName,
                    });
                }
            }

            // ── ٢) مراقبة ربط الأجهزة لمن انضم حديثاً ──
            const watchedKeys = Object.entries(g.members)
                .filter(([k, rec]) =>
                    rec.notified && rec.devices !== null && rec.devices !== undefined &&
                    !todo.includes(k) && ts - rec.joinedAt < DEVICE_WATCH_MS
                )
                .map(([k]) => k);

            if (watchedKeys.length) {
                const counts = await fetchDeviceCounts(sock, watchedKeys.map(k => recJid(g.members[k])));
                let groupLink = null;

                for (const k of watchedKeys) {
                    const rec = g.members[k];
                    const jid = recJid(rec);
                    const cur = counts.get(digitsOf(jid));
                    if (cur === null || cur === undefined) continue;
                    if (cur <= (rec.devices || 0)) continue;

                    const prev = rec.devices || 0;
                    rec.devices = cur;
                    results.deviceNotices++;

                    if (groupLink === null) groupLink = await getGroupLink(sock, groupId);
                    const body = [
                        mentionLine(digitsOf(jid), 'رابـط جـهـاز بـعـد انـضـمـامـه'),
                        devicesLine(cur, prev),
                        groupLink ? linkLine(groupLink) : '',
                    ].filter(Boolean).join('\n');

                    await sendNotice(sock, groupId, {
                        status: 'رابـط جـهـاز جـديـد ⚠️',
                        body, mentions: [jid], groupName,
                    });
                }
            }

            saveState();
        } catch (e) {
            console.error(chalk.red('[raqib] scan error'), groupId, e?.message);
        }
    }

    return results;
}

/** كل القروبات المسجّلة */
const allGroupIds = () => Object.keys(state.groups);

/** جلب كل القروبات الحية من الاتصال الحالي */
async function liveGroupIds(sock) {
    try {
        const all = await sock.groupFetchAllParticipating();
        return Object.keys(all || {});
    } catch {
        return null;
    }
}

// ── كشف فوري للانضمام: يمرّ عبر فحص الأجهزة ثم يُعلن فقط
//    من معه أجهزة مرتبطة — يشمل أصحاب اليوزرات (@lid) ──
const joinHandler = async (sock, update) => {
    const { action, id: groupId, participants } = update;
    if (action !== 'add' || !groupId?.endsWith?.('@g.us')) return;

    try {
        const meta = await getGroupMeta(sock, groupId, { force: true }).catch(() => null);
        const groupName = meta?.subject || groupId;
        const g = grp(groupId);
        g.name = groupName;

        const fresh = [];
        for (const p of (participants || [])) {
            const idn = await resolveFull(sock, groupId, p, meta);
            if (!idn.jid) continue;
            if (isBotId(sock, idn)) continue;

            const k = findKey(g, idn) || idn.key;
            if (g.members[k]) { refreshRec(g.members[k], idn); continue; }   // معروف → لا نكرر

            g.members[k] = { joinedAt: Date.now(), devices: null, notified: true, tries: 0, pn: idn.pn, lid: idn.lid };
            fresh.push({ k, jid: idn.jid });
        }

        if (!fresh.length) { saveState(); return; }

        const counts = await fetchDeviceCounts(sock, fresh.map(f => f.jid));
        let groupLink = null;

        for (const f of fresh) {
            const rec = g.members[f.k];
            const devs = counts.get(digitsOf(f.jid));

            if (devs === null || devs === undefined) {
                rec.notified = false;      // فشل الفحص → الفحص الدوري يعيد المحاولة
                rec.tries = 1;
                continue;
            }
            rec.devices = devs;
            if (devs <= 0) continue;

            if (groupLink === null) groupLink = await getGroupLink(sock, groupId);
            const body = [
                mentionLine(digitsOf(f.jid), 'انـضـم لـلـتـو'),
                devicesLine(devs),
                groupLink ? linkLine(groupLink) : '',
            ].filter(Boolean).join('\n');

            await sendNotice(sock, groupId, {
                status: 'عـضـو جـديـد رابـط جـهـاز ⚠️',
                body, mentions: [f.jid], groupName,
            });
        }

        saveState();
    } catch (e) {
        console.error(chalk.red('[raqib] join error'), e?.message);
    }
};

// ── تسجيل: مستمع الانضمام + مؤقّت الفحص الدوري ──
if (!global.groupEvHandlers) global.groupEvHandlers = [];
global.groupEvHandlers = global.groupEvHandlers.filter(h => h.__pluginTag !== 'raqib');
joinHandler.__pluginTag = 'raqib';
global.groupEvHandlers.push(joinHandler);

if (global.__raqibTimer) clearInterval(global.__raqibTimer);

global.__raqibTimer = setInterval(async () => {
    try {
        const sock = global.__activeSock || global.__raqibSock;
        if (!sock) return;

        // نزامن قائمة القروبات — القروب الجديد يُسجَّل كقاعدة مرجعية
        const live = await liveGroupIds(sock);
        if (live) {
            for (const id of live) grp(id);
            // القروب اللي طلع البوت منه → نحذف حالته
            for (const id of allGroupIds()) {
                if (!live.includes(id)) {
                    const g = state.groups[id];
                    if (!g.lastScan) delete state.groups[id];
                }
            }
            if (!live.length) { saveState(); return; }
        }

        const ids = live && live.length ? live : allGroupIds();
        if (!ids.length) return;

        const r = await scan(sock, ids, { announce: true });
        if (r.joins || r.deviceNotices) {
            console.log(chalk.cyan(`[raqib] دورة: ${r.joins} منضم، ${r.deviceNotices} ربط جهاز`));
        }
        saveState();
    } catch (e) {
        console.error(chalk.red('[raqib] tick error'), e?.message);
    }
}, SCAN_INTERVAL_MS);
global.__raqibTimer.unref?.();

console.log(chalk.green(`✅ [RAQIB] مراقب الأعضاء مفعّل (كل ${SCAN_INTERVAL_MS / 60000} دقائق)`));

export default {
    NovaUltra: {
        command: ['راقب', 'watch', 'مراقب_اعضاء'],
        description: 'فحص تلقائي كل 5 دقائق — يبلّغ عن الأعضاء ذوي الأجهزة المرتبطة فقط',
        elite: 'on',
        group: false,
        prv: false,
        lock: 'off',
    },
    execute: async ({ sock, msg, args }) => {
        const chatId = msg.key.remoteJid;
        global.__raqibSock = sock;

        // ── `.راقب فحص` → فحص فوري الآن ──
        if (args?.[0] === 'فحص' || args?.[0] === 'scan') {
            const status = await sock.sendMessage(chatId, {
                text: '⏳ _جاري الفحص الفوري لجميع القروبات..._'
            }, { quoted: msg });

            const live = await liveGroupIds(sock);
            const ids = live && live.length ? live : allGroupIds();
            for (const id of ids) grp(id);

            const r = await scan(sock, ids, { announce: true });
            saveState(true);

            await sock.sendMessage(chatId, {
                text: `✅ *انتهى الفحص الفوري*

👥 القروبات   : ${r.groups}
🆕 منضمين     : ${r.joins}
🔌 ربط أجهزة  : ${r.deviceNotices}
🗄️ قواعد مرجعية: ${r.baseline}
⏱️ الدورة التالية بعد ${SCAN_INTERVAL_MS / 60000} دقائق`,
                edit: status.key
            }).catch(() => {});
            return;
        }

        // ── `.راقب` → لوحة الحالة ──
        const ids = allGroupIds();

        let groupsLine = '— لا توجد قروبات مسجّلة بعد —';
        if (ids.length) {
            const preview = ids.slice(0, 8).map(id => {
                const g = state.groups[id];
                const n = Object.keys(g.members || {}).length;
                return `  • ${g.name || id}  (👥 ${n})`;
            });
            groupsLine = preview.join('\n') + (ids.length > 8 ? `\n  … و${ids.length - 8} آخر` : '');
        }

        let watching = 0;
        for (const g of Object.values(state.groups)) {
            for (const r of Object.values(g.members || {})) {
                if (r.devices !== null && Date.now() - r.joinedAt < DEVICE_WATCH_MS) watching++;
            }
        }

        await sock.sendMessage(chatId, {
            text:
`👁️ مراقب الأعضاء والأجهزة

⏱️ الفحص التلقائي  : كل ${SCAN_INTERVAL_MS / 60000} دقائق
🔍 نافذة مراقبة الأجهزة : ${DEVICE_WATCH_MS / 3600000} ساعة
📋 القروبات المراقبة : ${ids.length}
👥 أعضاء تحت المراقبة : ${watching}
📬 الإشعارات تذهب لـ : ${NOTIFY_JID}

⚠️ لا يُرسل إشعار إلا لمن معه *أجهزة مرتبطة*

${groupsLine}

📌 الاستخدام:
  \`.راقب\` → هذه اللوحة
  \`.راقب فحص\` → فحص فوري الآن`,
        }, { quoted: msg });
    },
};
