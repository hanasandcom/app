// Derived from Hanasand website norwegianCalendar.ts at a71de441; preserves its document format and calculations.
// Gregorian Easter (Meeus/Jones/Butcher), followed by Norway's public holidays.
// Holiday set: https://www.norges-bank.no/en/topics/Norges-Banks-settlement-system/Settlement-days/
export function norwegianHolidays(year: number) {
    const a = year % 19, b = Math.floor(year / 100), c = year % 100
    const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3)
    const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4
    const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451)
    const month = Math.floor((h + l - 7 * m + 114) / 31), date = (h + l - 7 * m + 114) % 31 + 1
    const easter = Date.UTC(year, month - 1, date)
    const holidays = new Map<string, string>()
    for (const [date, name] of [['01-01', 'New Year\'s Day'], ['05-01', 'Labour Day'], ['05-17', 'Constitution Day'], ['12-25', 'Christmas Day'], ['12-26', 'Boxing Day']]) holidays.set(`${year}-${date}`, name)
    for (const [offset, name] of [[-3, 'Maundy Thursday'], [-2, 'Good Friday'], [0, 'Easter Sunday'], [1, 'Easter Monday'], [39, 'Ascension Day'], [49, 'Whit Sunday'], [50, 'Whit Monday']] as const) {
        const date = new Date(easter + offset * 86400000).toISOString().slice(0, 10)
        holidays.set(date, [holidays.get(date), name].filter(Boolean).join(' / '))
    }
    return holidays
}
export function expectedWeek(start: string, week: number, firstYear: number, scheduled: boolean) {
    const exclusions: string[] = []
    if (!scheduled) return { hours: 0, exclusions: ['Outside the planned rows'] }
    if (week >= 51) return { hours: 0, exclusions: ['Christmas break (weeks 51–53)'] }
    let hundredths = 0
    for (let index = 0; index < 5; index++) {
        const date = new Date(Date.parse(start) + index * 86400000).toISOString().slice(0, 10)
        const year = Number(date.slice(0, 4))
        const holiday = norwegianHolidays(year).get(date)
        if (holiday) exclusions.push(`${date}: ${holiday}`)
        else hundredths += year <= firstYear ? 240 : 750
    }
    return { hours: hundredths / 100, exclusions }
}
