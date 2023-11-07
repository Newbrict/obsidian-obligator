----
## Personal tasks
{{ obligate 1,15 * * }}
- [ ] water the plants (added on the 1st and 15th of every month)
## Work tasks
{{ obligate * * 3 }}
- [ ] write the weekly email (added every Wednesday)
{{ obligate * * 5 }}
- [ ] send the weekly email (added every Friday)
## Further Obligator template examples
{{ obligate * * * }}
- [ ] every time a new note is made
{{ obligate 1 2 * }}
- [ ] Add this on the 1st of February
{{ obligate * 1-6 1,5 }}
- [ ] every Monday and Wednesday for the first 6 months of the year
{{ obligate 1-7,15-21 1,3,5,7,9,11 7 }}
- [ ] every other Sunday but only every other month
{{ obligate * 10-12 * }}
- [ ] every day in Q4
{{ obligate 1 1,4,7,10 * }}
- [ ] on the first of every quarter
{{ obligate 20 10 * }}
- [ ] on the 20th of October
{{ obligate 20 10 7 }}
- [ ] on the 20th of October, if it's a Sunday
# 🥕
----

Created on {{date}} {{time}}
Previous note: [[{{previous_note_path}}|{{previous_note}}]]
