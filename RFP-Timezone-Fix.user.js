// ==UserScript==
// @name         RFP Timezone Fix (Per-Site Exceptions)
// @namespace    https://github.com/VitaKaninen
// @version      1.2.0
// @description  Undo LibreWolf's/Firefox's Resist Fingerprinting's UTC timezone spoof on a per-site exception list, so timestamps show your real local time only where you allow it.
// @author       VitaKaninen
// @match        *://*/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @run-at       document-start
// @updateURL    https://raw.githubusercontent.com/VitaKaninen/RFP-Timezone-Fix/main/RFP-Timezone-Fix.user.js
// @downloadURL  https://raw.githubusercontent.com/VitaKaninen/RFP-Timezone-Fix/main/RFP-Timezone-Fix.user.js
// ==/UserScript==

(function() {
    'use strict';
 
    const SITES_KEY = 'rfpFixSites';
    const ZONE_KEY = 'rfpFixZone';
 
    // ---------------- Persisted settings ----------------
 
    function getActiveSites() {
        const stored = GM_getValue(SITES_KEY, null);
        if (stored === null) return [];
        try { return JSON.parse(stored); } catch (_) { return []; }
    }
    function saveActiveSites(list) {
        GM_setValue(SITES_KEY, JSON.stringify(list));
    }
    function getZone() {
        return GM_getValue(ZONE_KEY, '');
    }
    function saveZone(zone) {
        GM_setValue(ZONE_KEY, zone);
    }
    function isValidZone(zone) {
        if (!zone) return false;
        try {
            new Intl.DateTimeFormat('en-US', { timeZone: zone });
            return true;
        } catch (_) {
            return false;
        }
    }
 
    // Curated list of IANA zones with representative cities, roughly ordered
    // west to east by standard-time offset, for the picker UI.
    const TIMEZONE_CHOICES = [
        { zone: 'Pacific/Honolulu', label: 'Honolulu' },
        { zone: 'America/Anchorage', label: 'Anchorage' },
        { zone: 'America/Los_Angeles', label: 'Los Angeles, Seattle, Vancouver' },
        { zone: 'America/Phoenix', label: 'Phoenix (no DST)' },
        { zone: 'America/Denver', label: 'Denver, Salt Lake City' },
        { zone: 'America/Chicago', label: 'Chicago, Dallas, Houston' },
        { zone: 'America/Mexico_City', label: 'Mexico City' },
        { zone: 'America/New_York', label: 'New York, Atlanta, Miami, Toronto' },
        { zone: 'America/Halifax', label: 'Halifax' },
        { zone: 'America/Sao_Paulo', label: 'São Paulo, Rio de Janeiro' },
        { zone: 'America/Argentina/Buenos_Aires', label: 'Buenos Aires' },
        { zone: 'Atlantic/Azores', label: 'Azores' },
        { zone: 'Etc/UTC', label: 'UTC' },
        { zone: 'Europe/London', label: 'London, Dublin, Lisbon' },
        { zone: 'Europe/Paris', label: 'Paris, Berlin, Madrid, Rome' },
        { zone: 'Europe/Athens', label: 'Athens, Cairo, Helsinki' },
        { zone: 'Europe/Moscow', label: 'Moscow, Istanbul' },
        { zone: 'Asia/Dubai', label: 'Dubai, Abu Dhabi' },
        { zone: 'Asia/Karachi', label: 'Karachi, Islamabad' },
        { zone: 'Asia/Kolkata', label: 'Mumbai, New Delhi, Bangalore' },
        { zone: 'Asia/Dhaka', label: 'Dhaka' },
        { zone: 'Asia/Bangkok', label: 'Bangkok, Jakarta' },
        { zone: 'Asia/Shanghai', label: 'Beijing, Shanghai, Singapore, Hong Kong' },
        { zone: 'Asia/Tokyo', label: 'Tokyo, Seoul, Osaka' },
        { zone: 'Australia/Sydney', label: 'Sydney, Melbourne' },
        { zone: 'Pacific/Auckland', label: 'Auckland, Wellington' }
    ];
 
    // Live "UTC±HH:MM" label for a zone, accounting for current DST state —
    // purely informational, shown next to each city in the picker.
    function currentOffsetLabel(zone) {
        try {
            const dtf = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' });
            const part = dtf.formatToParts(new Date()).find(p => p.type === 'timeZoneName');
            return part ? part.value.replace('GMT', 'UTC') : '';
        } catch (_) {
            return '';
        }
    }
 
    // ---------------- Site matching ----------------
 
    function hostnameMatches(hostname, domain) {
        return hostname === domain || hostname.endsWith('.' + domain);
    }
    function isActiveSite() {
        const hostname = location.hostname.toLowerCase();
        return getActiveSites().some(d => hostnameMatches(hostname, d.toLowerCase()));
    }
 
    // ---------------- Core timezone patch ----------------
    // Applies only when this site is in the exception list AND a valid zone is set.
    // Patches the PAGE's real Date/Intl (via unsafeWindow), not the userscript's
    // sandboxed copy, so the page's own scripts see the corrected values.
 
    function applyTimezonePatch(zone) {
        const W = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
        const RealDate = W.Date;
        const RealIntlDTF = W.Intl.DateTimeFormat;
        const DatePrototype = RealDate.prototype;
 
        function zonedParts(date) {
            const dtf = new RealIntlDTF('en-US', {
                timeZone: zone,
                hourCycle: 'h23',
                year: 'numeric', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit', second: '2-digit',
                weekday: 'short'
            });
            const parts = dtf.formatToParts(date).reduce((acc, p) => {
                acc[p.type] = p.value;
                return acc;
            }, {});
            const weekdayIndex = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
            // Interpret the zone's wall-clock reading as if it were UTC, to
            // derive the offset by diffing against the real UTC epoch.
            const asUTC = RealDate.UTC(
                Number(parts.year), Number(parts.month) - 1, Number(parts.day),
                parts.hour === '24' ? 0 : Number(parts.hour), Number(parts.minute), Number(parts.second)
            );
            // Matches native getTimezoneOffset() sign convention (minutes to
            // ADD to local time to reach UTC; positive = behind UTC).
            const offsetMinutes = Math.round((date.getTime() - asUTC) / 60000);
            return {
                year: Number(parts.year),
                month: Number(parts.month) - 1,
                day: Number(parts.day),
                hour: parts.hour === '24' ? 0 : Number(parts.hour),
                minute: Number(parts.minute),
                second: Number(parts.second),
                weekday: weekdayIndex,
                offsetMinutes
            };
        }
 
        function pad(n, len) {
            return String(n).padStart(len || 2, '0');
        }
        function formatOffsetString(offsetMinutes) {
            const stringOffset = -offsetMinutes; // native toString uses the opposite sign convention
            const sign = stringOffset <= 0 ? '-' : '+';
            const abs = Math.abs(stringOffset);
            return `GMT${sign}${pad(Math.floor(abs / 60))}${pad(abs % 60)}`;
        }
 
        const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
 
        function zoneLongName(date) {
            try {
                const dtf = new RealIntlDTF('en-US', { timeZone: zone, timeZoneName: 'long' });
                const part = dtf.formatToParts(date).find(p => p.type === 'timeZoneName');
                return part ? part.value : zone;
            } catch (_) {
                return zone;
            }
        }
 
        // ---- Getters: the highest-value fix, since most date libraries
        // (moment, dayjs, date-fns, luxon) build "local" time from these. ----
        DatePrototype.getFullYear = function() { return zonedParts(this).year; };
        DatePrototype.getMonth = function() { return zonedParts(this).month; };
        DatePrototype.getDate = function() { return zonedParts(this).day; };
        DatePrototype.getHours = function() { return zonedParts(this).hour; };
        DatePrototype.getMinutes = function() { return zonedParts(this).minute; };
        DatePrototype.getSeconds = function() { return zonedParts(this).second; };
        DatePrototype.getDay = function() { return zonedParts(this).weekday; };
        DatePrototype.getTimezoneOffset = function() { return zonedParts(this).offsetMinutes; };
 
        // ---- String forms ----
        DatePrototype.toString = function() {
            const p = zonedParts(this);
            return `${DAY_NAMES[p.weekday]} ${MONTH_NAMES[p.month]} ${pad(p.day)} ${p.year} `
                 + `${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)} ${formatOffsetString(p.offsetMinutes)} (${zoneLongName(this)})`;
        };
        DatePrototype.toDateString = function() {
            const p = zonedParts(this);
            return `${DAY_NAMES[p.weekday]} ${MONTH_NAMES[p.month]} ${pad(p.day)} ${p.year}`;
        };
        DatePrototype.toTimeString = function() {
            const p = zonedParts(this);
            return `${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)} ${formatOffsetString(p.offsetMinutes)} (${zoneLongName(this)})`;
        };
        DatePrototype.toLocaleString = function(locales, options) {
            const opts = Object.assign({}, options, { timeZone: (options && options.timeZone) || zone });
            return new RealIntlDTF(locales || 'en-US', opts).format(this);
        };
        DatePrototype.toLocaleDateString = function(locales, options) {
            const opts = Object.assign({ year: 'numeric', month: 'numeric', day: 'numeric' }, options, {
                timeZone: (options && options.timeZone) || zone
            });
            return new RealIntlDTF(locales || 'en-US', opts).format(this);
        };
        DatePrototype.toLocaleTimeString = function(locales, options) {
            const opts = Object.assign({ hour: 'numeric', minute: 'numeric', second: 'numeric' }, options, {
                timeZone: (options && options.timeZone) || zone
            });
            return new RealIntlDTF(locales || 'en-US', opts).format(this);
        };
 
        // ---- Intl.DateTimeFormat: inject the real zone as the default when
        // the caller didn't explicitly ask for one (this is what most sites
        // actually use for "time ago" / timestamp rendering). ----
        function PatchedDTF(locales, options) {
            if (!options || !options.timeZone) {
                options = Object.assign({}, options, { timeZone: zone });
            }
            return new RealIntlDTF(locales, options);
        }
        PatchedDTF.prototype = RealIntlDTF.prototype;
        PatchedDTF.supportedLocalesOf = RealIntlDTF.supportedLocalesOf;
        W.Intl.DateTimeFormat = PatchedDTF;
    }
 
    // Apply as early as possible (document-start) so page scripts never see
    // the spoofed values in the first place.
    (function init() {
        if (!isActiveSite()) return;
        const zone = getZone();
        if (!isValidZone(zone)) return; // no valid zone configured yet — do nothing
        applyTimezonePatch(zone);
    })();
 
    // ---------------- Settings Panel ----------------
    // Same shape as your Open-Links-in-New-Tab settings: shadow DOM (so page
    // CSS can't bleed in), a zone input, and a site list with add/remove/+.
 
    function openSettingsPanel() {
        if (document.getElementById('gm-rfp-tz-settings')) return;
 
        const host = document.createElement('div');
        host.id = 'gm-rfp-tz-settings';
        host.style.cssText = 'all: initial;';
        const root = host.attachShadow({ mode: 'open' });
 
        const resetStyle = document.createElement('style');
        resetStyle.textContent = ':host { all: initial; } * { box-sizing: border-box; }';
        root.appendChild(resetStyle);
 
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: fixed; inset: 0; z-index: 2147483646;
            background: rgba(0,0,0,0.6); display: flex;
            align-items: center; justify-content: center; font-family: system-ui, sans-serif;
        `;
 
        const panel = document.createElement('div');
        panel.style.cssText = `
            background: #1e1e2e; color: #cdd6f4; border-radius: 10px;
            padding: 20px 24px; width: 440px; max-height: 80vh;
            display: flex; flex-direction: column; gap: 12px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.5); overflow: hidden;
        `;
 
        const title = document.createElement('div');
        title.style.cssText = 'font-size: 15px; font-weight: 700; color: #89b4fa;';
        title.textContent = 'RFP Timezone Fix — Settings';
 
        // ---- Zone field: a text input is the actual source of truth, with
        // an optional "Pick from list" helper that just types a zone name
        // into the box for you — it never saves on its own. ----
        const zoneWrap = document.createElement('div');
        zoneWrap.style.cssText = 'display: flex; flex-direction: column; gap: 6px;';
 
        const zoneDesc = document.createElement('div');
        zoneDesc.style.cssText = 'font-size: 12px; color: #9399b2; line-height: 1.45;';
        zoneDesc.textContent = 'Your real IANA timezone (DST handled automatically). Type it directly, or pick a city to fill it in.';
        zoneWrap.appendChild(zoneDesc);
 
        const zoneRow = document.createElement('div');
        zoneRow.style.cssText = 'display: flex; gap: 6px;';
        const zoneInput = document.createElement('input');
        zoneInput.type = 'text';
        zoneInput.placeholder = 'e.g. America/New_York';
        zoneInput.value = getZone();
        zoneInput.style.cssText = `
            flex: 1; padding: 6px 10px; border-radius: 6px; border: 1px solid #45475a;
            background: #313244; color: #cdd6f4; font-size: 13px; outline: none;
        `;
        const pickToggleBtn = document.createElement('button');
        pickToggleBtn.textContent = 'Pick from list…';
        pickToggleBtn.style.cssText = `
            padding: 6px 10px; border-radius: 6px; border: none;
            background: #45475a; color: #cdd6f4; font-weight: 600;
            font-size: 13px; cursor: pointer; white-space: nowrap;
        `;
        const zoneSaveBtn = document.createElement('button');
        zoneSaveBtn.textContent = 'Save';
        zoneSaveBtn.style.cssText = `
            padding: 6px 12px; border-radius: 6px; border: none;
            background: #89b4fa; color: #1e1e2e; font-weight: 700;
            font-size: 13px; cursor: pointer;
        `;
        zoneRow.appendChild(zoneInput);
        zoneRow.appendChild(pickToggleBtn);
        zoneRow.appendChild(zoneSaveBtn);
        zoneWrap.appendChild(zoneRow);
 
        const zoneStatus = document.createElement('span');
        zoneStatus.style.cssText = 'font-size: 12px; min-height: 16px; display: block;';
        function flashZoneStatus(msg, color) {
            zoneStatus.style.color = color || '#a6e3a1';
            zoneStatus.textContent = msg;
            clearTimeout(zoneStatus._t);
            zoneStatus._t = setTimeout(() => { zoneStatus.textContent = ''; }, 3000);
        }
        zoneWrap.appendChild(zoneStatus);
 
        zoneSaveBtn.addEventListener('click', () => {
            const value = zoneInput.value.trim();
            if (!isValidZone(value)) {
                flashZoneStatus('Not a recognized IANA zone name.', '#f38ba8');
                return;
            }
            saveZone(value);
            flashZoneStatus('Saved. Reload open tabs to apply.');
        });
 
        // ---- Collapsible picker list — hidden until "Pick from list…" is
        // clicked, so it doesn't take up space the rest of the time. ----
        const zoneList = document.createElement('div');
        zoneList.style.cssText = `
            display: none; overflow-y: auto; max-height: 200px; flex-direction: column;
            gap: 3px; border: 1px solid #45475a; border-radius: 6px; padding: 6px;
        `;
        TIMEZONE_CHOICES.forEach(choice => {
            const row = document.createElement('button');
            row.style.cssText = `
                display: flex; justify-content: space-between; align-items: center;
                text-align: left; padding: 6px 10px; border-radius: 6px; border: none;
                background: #313244; color: #cdd6f4;
                font-size: 13px; cursor: pointer; width: 100%;
            `;
            const cityLabel = document.createElement('span');
            cityLabel.textContent = choice.label;
            const offsetLabel = document.createElement('span');
            offsetLabel.style.cssText = 'font-size: 11px; color: #9399b2; flex-shrink: 0; margin-left: 8px;';
            offsetLabel.textContent = currentOffsetLabel(choice.zone);
            row.appendChild(cityLabel);
            row.appendChild(offsetLabel);
            row.addEventListener('click', () => {
                zoneInput.value = choice.zone; // fills the box — Save still required
                zoneList.style.display = 'none';
                zoneInput.focus();
            });
            zoneList.appendChild(row);
        });
        pickToggleBtn.addEventListener('click', () => {
            zoneList.style.display = zoneList.style.display === 'none' ? 'flex' : 'none';
        });
        zoneWrap.appendChild(zoneList);
 
        // ---- Site exception list ----
        const sitesDesc = document.createElement('div');
        sitesDesc.style.cssText = 'font-size: 12px; color: #9399b2; line-height: 1.45; margin-top: 4px;';
        sitesDesc.textContent = 'Sites where the fix is applied. Everywhere else keeps full RFP protection (spoofed to UTC).';
 
        const addRow = document.createElement('div');
        addRow.style.cssText = 'display: flex; gap: 6px;';
        const siteInput = document.createElement('input');
        siteInput.type = 'text';
        siteInput.placeholder = 'e.g. steampowered.com';
        siteInput.style.cssText = `
            flex: 1; padding: 6px 10px; border-radius: 6px; border: 1px solid #45475a;
            background: #313244; color: #cdd6f4; font-size: 13px; outline: none;
        `;
        const addBtn = document.createElement('button');
        addBtn.textContent = 'Add';
        addBtn.style.cssText = `
            padding: 6px 12px; border-radius: 6px; border: none;
            background: #89b4fa; color: #1e1e2e; font-weight: 700;
            font-size: 13px; cursor: pointer;
        `;
        const addCurrentBtn = document.createElement('button');
        addCurrentBtn.textContent = '+ This Site';
        addCurrentBtn.title = 'Add the current site (' + location.hostname + ')';
        addCurrentBtn.style.cssText = `
            padding: 6px 10px; border-radius: 6px; border: none;
            background: #a6e3a1; color: #1e1e2e; font-weight: 700;
            font-size: 13px; cursor: pointer; white-space: nowrap;
        `;
        addRow.appendChild(siteInput);
        addRow.appendChild(addBtn);
        addRow.appendChild(addCurrentBtn);
 
        const list = document.createElement('div');
        list.style.cssText = `
            overflow-y: auto; display: flex; flex-direction: column; gap: 5px;
            flex: 1; min-height: 0; padding-right: 4px; max-height: 260px;
        `;
 
        function normalizeDomain(raw) {
            return raw.trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
        }
 
        function renderList() {
            while (list.firstChild) list.removeChild(list.firstChild);
            const items = getActiveSites();
            if (items.length === 0) {
                const empty = document.createElement('div');
                empty.style.cssText = 'color: #6c7086; font-size: 13px; text-align: center; padding: 12px 0;';
                empty.textContent = 'No sites added yet.';
                list.appendChild(empty);
                return;
            }
            items.forEach((item, i) => {
                const row = document.createElement('div');
                row.style.cssText = `
                    display: flex; align-items: center; justify-content: space-between;
                    background: #313244; border-radius: 6px; padding: 6px 10px;
                `;
                const label = document.createElement('span');
                label.style.cssText = 'font-size: 13px; word-break: break-all;';
                label.textContent = item;
                const removeBtn = document.createElement('button');
                removeBtn.textContent = '✕';
                removeBtn.style.cssText = `
                    background: none; border: none; color: #f38ba8;
                    cursor: pointer; font-size: 14px; padding: 0 4px; flex-shrink: 0;
                `;
                removeBtn.title = 'Remove ' + item;
                removeBtn.addEventListener('click', () => {
                    const updated = getActiveSites().filter((_, j) => j !== i);
                    saveActiveSites(updated);
                    renderList();
                });
                row.appendChild(label);
                row.appendChild(removeBtn);
                list.appendChild(row);
            });
        }
 
        function addSite(raw) {
            const value = normalizeDomain(raw);
            if (!value) return;
            const items = getActiveSites();
            if (items.includes(value)) return;
            items.push(value);
            saveActiveSites(items);
            renderList();
            siteInput.value = '';
        }
 
        addBtn.addEventListener('click', () => addSite(siteInput.value));
        siteInput.addEventListener('keydown', e => { if (e.key === 'Enter') addSite(siteInput.value); });
        addCurrentBtn.addEventListener('click', () => addSite(location.hostname));
 
        renderList();
 
        const note = document.createElement('div');
        note.style.cssText = 'font-size: 11px; color: #6c7086; line-height: 1.4;';
        note.textContent = 'Changes take effect on page load/reload — the fix runs at document-start, before it can be applied retroactively.';
 
        const closeBtn = document.createElement('button');
        closeBtn.textContent = 'Close';
        closeBtn.style.cssText = `
            align-self: flex-end; padding: 6px 16px; border-radius: 6px; border: none;
            background: #45475a; color: #cdd6f4; font-weight: 600;
            font-size: 13px; cursor: pointer; margin-top: 4px;
        `;
        closeBtn.addEventListener('click', () => host.remove());
        overlay.addEventListener('click', e => { if (e.target === overlay) host.remove(); });
 
        panel.appendChild(title);
        panel.appendChild(zoneWrap);
        panel.appendChild(sitesDesc);
        panel.appendChild(addRow);
        panel.appendChild(list);
        panel.appendChild(note);
        panel.appendChild(closeBtn);
        overlay.appendChild(panel);
        root.appendChild(overlay);
        document.documentElement.appendChild(host);
    }
 
    GM_registerMenuCommand('Settings', openSettingsPanel);
})();