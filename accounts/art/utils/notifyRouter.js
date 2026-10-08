// ══════════════════════════════════════════════════════════════
//  utils/notifyRouter.js — توزيع الإشعارات على قروبات متعددة
//
//  • TARGETS = قروبات الإشعارات المرقمة (تحط الـ JID هنا مرة وحدة)
//  • القروب المراقَب يتسجّل في رقم بالأمر  .قروب <رقم>  وهو داخله
//  • إشعارات أي قروب مسجّل تروح لقروب الإشعارات حق رقمه
//  • القروب الأساسي (NOTIFY_JID) يستلم **كل** الإشعارات دائماً
//  • قروب غير مسجّل ← الأساسي فقط
// ══════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { NOTIFY_JID } from './notifyJid.js';

// ✏️ عدّل هنا: رقم المجموعة ← JID قروب الإشعارات حقها
export const TARGETS = {
    1: '120363414651872167@g.us',
    2: '120363429603910085@g.us',
    3: '120363409633496385@g.us',
    4: '120363411315559654@g.us',
    5: '120363430319931978@g.us',
    6: '120363431647806933@g.us',
    7: '120363430743222678@g.us',
    // 3: '...@g.us',
};

export const MAIN_JID = NOTIFY_JID;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR  = path.join(__dirname, '../nova/data');
const DATA_FILE = path.join(DATA_DIR, 'notify-routes.json');

// { sources: { "<groupJid>": 1 } }
let state = { sources: {} };
try {
    if (fs.existsSync(DATA_FILE)) {
        const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        if (raw?.sources && typeof raw.sources === 'object') state = { sources: raw.sources };
    }
} catch (e) {
    console.error('[notifyRouter] تعذّر قراءة الملف:', e.message);
}

function save() {
    try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2), 'utf8');
    } catch (e) {
        console.error('[notifyRouter] تعذّر الحفظ:', e.message);
    }
}

export const slotExists = n => typeof TARGETS[n] === 'string';
export const getSlotOf  = groupJid => state.sources[groupJid] ?? null;

/** يسجّل القروب في مجموعة (يستبدل أي مجموعة سابقة له) */
export function assignGroup(groupJid, n) {
    state.sources[groupJid] = n;
    save();
}

/** يشيل القروب من مجموعته. يرجع رقم المجموعة اللي كان فيها أو null */
export function unassignGroup(groupJid) {
    const prev = state.sources[groupJid] ?? null;
    delete state.sources[groupJid];
    save();
    return prev;
}

/** القروبات المسجّلة في مجموعة معيّنة */
export const groupsOfSlot = n =>
    Object.entries(state.sources).filter(([, v]) => v === n).map(([k]) => k);

/** كل القروبات اللي لازم يوصلها إشعار قروب المصدر (بدون تكرار) */
export function getTargets(sourceGroupId) {
    const slot = state.sources[sourceGroupId];
    const routed = slot != null ? TARGETS[slot] : null;
    return [...new Set([routed, MAIN_JID].filter(Boolean))];
}

/** يرسل الإشعار للقروب المخصص + الأساسي. فشل أحدهم ما يوقف الباقي */
export async function sendNotify(sock, sourceGroupId, content) {
    let lastErr = null;
    let ok = 0;
    for (const jid of getTargets(sourceGroupId)) {
        try {
            await sock.sendMessage(jid, content);
            ok++;
        } catch (e) {
            lastErr = e;
            console.error('[notifyRouter] فشل الإرسال إلى', jid, e?.message);
        }
    }
    if (!ok && lastErr) throw lastErr;
}
