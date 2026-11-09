export const formatEventTimeRange = (timeStr: string, durationMin: number, title?: string) => {
    let parsedTime = String(timeStr || "").trim();
    
    // If it's a known placeholder or empty, try parsing from title
    if (parsedTime.toLowerCase().includes("11:59 pm") || parsedTime.toLowerCase().includes("all day") || !parsedTime) {
        const titleMatch = (title || "").match(/^(\d{1,2}[:.]\d{2}(?:\s*(?:am|pm))?)/i) || (title || "").match(/^(\d{1,2}(?:\s*(?:am|pm))?)/i);
        if (titleMatch) {
            parsedTime = titleMatch[1].replace('.', ':');
            if (!parsedTime.includes(':')) parsedTime += ":00";
        }
    }

    if (!parsedTime) return "All Day";

    // If it's already a clean range but not the default all day
    if (parsedTime.includes("-") && !parsedTime.toLowerCase().includes("11:59 pm")) {
        return parsedTime;
    }

    let h = 0, m = 0;
    const timeMatch = parsedTime.match(/(\d+)[:.](\d+)\s*(am|pm)?/i);
    if (timeMatch) {
        h = parseInt(timeMatch[1], 10);
        m = parseInt(timeMatch[2], 10);
        const ampm = timeMatch[3]?.toLowerCase();
        if (ampm === 'pm' && h < 12) h += 12;
        if (ampm === 'am' && h === 12) h = 0;
    } else {
        const hMatch = parsedTime.match(/(\d{1,2})\s*(am|pm)?/i);
        if (hMatch) {
            h = parseInt(hMatch[1], 10);
            const ampm = hMatch[2]?.toLowerCase();
            if (ampm === 'pm' && h < 12) h += 12;
            if (ampm === 'am' && h === 12) h = 0;
        } else {
            // Can't parse, just return original
            return timeStr;
        }
    }

    const startAmPm = h >= 12 ? 'pm' : 'am';
    const startH = h % 12 || 12;
    const startStr = `${startH}:${String(m).padStart(2, '0')} ${startAmPm}`;

    if (!durationMin) return startStr;

    const endTotalMin = h * 60 + m + (durationMin || 60);
    const endH24 = Math.floor(endTotalMin / 60) % 24;
    const endM = endTotalMin % 60;
    const endAmPm = endH24 >= 12 ? 'pm' : 'am';
    const endH = endH24 % 12 || 12;
    const endStr = `${endH}:${String(endM).padStart(2, '0')} ${endAmPm}`;

    return `${startStr} - ${endStr}`;
};

export const parseEventDate = (dateStr: string): Date => {
    if (!dateStr) return new Date(0);
    
    // Check for DD/MM/YYYY or DD-MM-YYYY
    const parts = dateStr.split(/[\/\-]/);
    if (parts.length === 3 && parts[1].match(/^\d+$/)) {
        let day = parseInt(parts[0], 10);
        let month = parseInt(parts[1], 10);
        let year = parseInt(parts[2], 10);
        
        if (day > 1000) {
            year = day;
            month = parseInt(parts[1], 10);
            day = parseInt(parts[2], 10);
        } else if (year < 100) {
            year += 2000;
        }
        
        if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
            return new Date(year, month - 1, day);
        }
    }
    
    let d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
        // Handle JS 2001 default for "DD-MMM"
        if (d.getFullYear() === 2001 && !dateStr.includes("2001")) {
            const currentYear = new Date().getFullYear();
            const withYear = new Date(`${dateStr} ${currentYear}`);
            if (!isNaN(withYear.getTime())) {
                return withYear;
            }
        }
        return d;
    }
    
    return new Date(0);
};

export const generateGroupEventsFromSchedule = (group: any, startDate: Date, daysCount: number = 35) => {
    const dateText = ((group.dateRule || "") || (group.scheduleText || "")).trim().toLowerCase();
    const timeText = ((group.timeRule || "") || (group.scheduleText || "")).trim().toLowerCase();
    
    if (!dateText && !timeText) return [];

    let freq = 'weekly';
    if (dateText.includes('once') || dateText.includes('single') || dateText.includes('one-off') || dateText.includes('one time')) {
        freq = 'once';
    } else if (dateText.includes('fortnight') || dateText.includes('biweek')) {
        freq = 'fortnightly';
    } else if (dateText.includes('month') || dateText.match(/\b(?:1st|2nd|3rd|4th|5th|last|first|second|third|fourth)\b/i)) {
        freq = 'monthly';
    }

    // Time & Duration
    let hours = 10;
    let minutes = 0;
    let duration = 60;

    const timeRanges = timeText.match(/(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?\s*(?:-|to)\s*(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?/i);
    if (timeRanges) {
        let h1 = parseInt(timeRanges[1], 10);
        let m1 = timeRanges[2] ? parseInt(timeRanges[2], 10) : 0;
        let ampm1 = timeRanges[3];

        let h2 = parseInt(timeRanges[4], 10);
        let m2 = timeRanges[5] ? parseInt(timeRanges[5], 10) : 0;
        let ampm2 = timeRanges[6];

        if (!ampm1 && ampm2) ampm1 = ampm2;

        if (ampm1 === 'pm' && h1 < 12) h1 += 12;
        if (ampm1 === 'am' && h1 === 12) h1 = 0;
        
        if (ampm2 === 'pm' && h2 < 12) h2 += 12;
        if (ampm2 === 'am' && h2 === 12) h2 = 0;

        hours = h1;
        minutes = m1;
        
        const startTotalMin = h1 * 60 + m1;
        let endTotalMin = h2 * 60 + m2;
        if (endTotalMin < startTotalMin) endTotalMin += 24 * 60;
        duration = endTotalMin - startTotalMin;
    } else {
        const durMatch = timeText.match(/(\d+(?:\.\d+)?)\s*(hour|hr|min|m)\b/i);
        if (durMatch) {
            const val = parseFloat(durMatch[1]);
            if (durMatch[2].toLowerCase().startsWith('h')) {
                duration = Math.round(val * 60);
            } else {
                duration = Math.round(val);
            }
        }

        const colonMatch = timeText.match(/\b(\d{1,2})[:.](\d{2})\s*(am|pm)?\b/i);
        if (colonMatch) {
            let h = parseInt(colonMatch[1], 10);
            const m = parseInt(colonMatch[2], 10);
            const ampm = colonMatch[3]?.toLowerCase();
            if (ampm === 'pm' && h < 12) h += 12;
            if (ampm === 'am' && h === 12) h = 0;
            hours = h;
            minutes = m;
        } else {
            const ampmMatch = timeText.match(/\b(\d{1,2})\s*(am|pm)\b/i);
            if (ampmMatch) {
                let h = parseInt(ampmMatch[1], 10);
                const ampm = ampmMatch[2].toLowerCase();
                if (ampm === 'pm' && h < 12) h += 12;
                if (ampm === 'am' && h === 12) h = 0;
                hours = h;
                minutes = 0;
            }
        }
    }

    const timeString = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;

    // Days of week
    const dayPatterns = [
        /\bsun(?:day|s)?\b/i,
        /\bmon(?:day|s)?\b/i,
        /\btue(?:sday|s|esday)?\b/i,
        /\bwed(?:nesday|s|ensday)?\b/i,
        /\bthu(?:rsday|rs|s)?\b/i,
        /\bfri(?:day|s)?\b/i,
        /\bsat(?:urday|s)?\b/i
    ];
    const targetDaysOfWeek: number[] = [];
    dayPatterns.forEach((regex, idx) => {
        if (regex.test(dateText)) {
            targetDaysOfWeek.push(idx);
        }
    });

    // Fallback to group name if no day mentioned in schedule
    if (targetDaysOfWeek.length === 0) {
        dayPatterns.forEach((regex, idx) => {
            if (regex.test(group.name || "")) {
                targetDaysOfWeek.push(idx);
            }
        });
    }

    // Exact Date
    const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    let exactMonth = -1;
    let exactDay = -1;
    monthNames.forEach((mName, idx) => {
        const regex = new RegExp(`\\b${mName}[a-z]*\\b`, 'i');
        if (regex.test(dateText)) {
            exactMonth = idx;
        }
    });
    if (exactMonth !== -1) {
        const dateRegex1 = dateText.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i);
        const dateRegex2 = dateText.match(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?\b/i);
        if (dateRegex1) exactDay = parseInt(dateRegex1[1], 10);
        else if (dateRegex2) exactDay = parseInt(dateRegex2[1], 10);
    }

    // Ordinal for monthly
    let ordinal = 1;
    if (/\b(first|1st)\b/i.test(dateText)) ordinal = 1;
    else if (/\b(second|2nd)\b/i.test(dateText)) ordinal = 2;
    else if (/\b(third|3rd)\b/i.test(dateText)) ordinal = 3;
    else if (/\b(fourth|4th)\b/i.test(dateText)) ordinal = 4;
    else if (/\b(last|final|fifth|5th)\b/i.test(dateText)) ordinal = -1;

    // NZ Public holidays set
    const nzHolidays = new Set([
        // 2025
        '2025-01-01', '2025-01-02', '2025-02-06', '2025-04-18', '2025-04-21', '2025-04-25', '2025-06-02', '2025-06-20', '2025-10-27', '2025-12-25', '2025-12-26',
        // 2026
        '2026-01-01', '2026-01-02', '2026-02-06', '2026-04-03', '2026-04-06', '2026-04-25', '2026-04-27', '2026-06-01', '2026-07-10', '2026-10-26', '2026-12-25', '2026-12-26', '2026-12-28',
        // 2027
        '2027-01-01', '2027-01-02', '2027-01-04', '2027-02-06', '2027-02-08', '2027-03-26', '2027-03-29', '2027-04-25', '2027-04-26', '2027-06-07', '2027-06-25', '2027-10-25', '2027-12-25', '2027-12-26', '2027-12-27', '2027-12-28',
        // 2028
        '2028-01-01', '2028-01-03', '2028-01-04', '2028-02-06', '2028-02-07', '2028-04-14', '2028-04-17', '2028-04-25', '2028-06-05', '2028-07-14', '2028-10-23', '2028-12-25', '2028-12-26'
    ]);

    const occurrences: { date: string; time: string; duration: number }[] = [];
    let lastFortnightDate: Date | null = null;

    for (let i = 0; i <= daysCount; i++) {
        const curr = new Date(startDate);
        curr.setDate(startDate.getDate() + i);
        curr.setHours(0, 0, 0, 0);

        const yr = curr.getFullYear();
        const mo = String(curr.getMonth() + 1).padStart(2, '0');
        const dy = String(curr.getDate()).padStart(2, '0');
        const dateStr = `${yr}-${mo}-${dy}`;

        let isMatch = false;

        if (freq === 'once') {
            if (exactMonth !== -1 && exactDay !== -1) {
                if (curr.getMonth() === exactMonth && curr.getDate() === exactDay) {
                    isMatch = true;
                }
            }
        } else if (freq === 'weekly') {
            if (targetDaysOfWeek.includes(curr.getDay())) {
                isMatch = true;
            }
        } else if (freq === 'fortnightly') {
            if (targetDaysOfWeek.includes(curr.getDay())) {
                if (!lastFortnightDate) {
                    isMatch = true;
                    lastFortnightDate = curr;
                } else {
                    const diffDays = Math.round((curr.getTime() - lastFortnightDate.getTime()) / (1000 * 60 * 60 * 24));
                    if (diffDays % 14 === 0) {
                        isMatch = true;
                        lastFortnightDate = curr;
                    }
                }
            }
        } else if (freq === 'monthly') {
            if (targetDaysOfWeek.length > 0) {
                if (targetDaysOfWeek.includes(curr.getDay())) {
                    if (ordinal > 0) {
                        const nth = Math.floor((curr.getDate() - 1) / 7) + 1;
                        if (nth === ordinal) isMatch = true;
                    } else if (ordinal === -1) {
                        const nextWeek = new Date(curr);
                        nextWeek.setDate(curr.getDate() + 7);
                        if (nextWeek.getMonth() !== curr.getMonth()) {
                            isMatch = true;
                        }
                    }
                }
            } else if (exactDay !== -1) {
                if (curr.getDate() === exactDay) isMatch = true;
            }
        }

        if (isMatch) {
            if (group.skipHolidays && nzHolidays.has(dateStr)) {
                continue;
            }
            occurrences.push({ date: dateStr, time: timeString, duration });
        }
    }

    return occurrences;
};

