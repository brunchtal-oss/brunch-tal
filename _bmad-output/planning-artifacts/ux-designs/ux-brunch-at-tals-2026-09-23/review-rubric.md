# Spine Pair Review — בראנץ׳ אצל טל

- **DESIGN.md / EXPERIENCE.md** (status: draft), נבדקו מול `.memlog.md` (עד 18:20) ומול SPEC.md, site-map.md, products-catalog.md, notification-matrix.md, cancellation-rules.md (ונבדקו גם glossary.md ו-data-model.md לצורך אימות).
- **חומרה:** blocker (אי אפשר להמשיך ל-architecture/stories) · major (הצרכן יצטרך לנחש או להמציא) · minor (ניסוח, עקביות, ליטוש).

## Overall verdict

זוג ה-spines מוצק: כל ההחלטות ב-memlog באות לידי ביטוי. כל ה-`{token}` מתפרקים לערכים, ו-15 יחסי הניגוד שנבדקו מחדש יוצאים מדויקים. זרימות הלקוחה (גילוי, הצטרפות, הרשמה מרובה, ביטול) מכסות היטב את כללי ה-SPEC. אין blockers. הפערים המהותיים נמצאים במשטחים שאין להם מסע או מצבים: רוב משטחי האדמין מלבד תשלומים ומפגשים, קישור איפוס סיסמה, בחירה אחרי ביטול מצד העסק ועזיבת רשימת המתנה. בנוסף, טענת ה-memlog ש"כל משטחי ה-site-map מכוסים במסעות" לא מתקיימת בפועל ב-EXPERIENCE.md.

## 1. Flow coverage — adequate

נבדק: לכל אחת מ-5 הזרימות יש גיבורה עם שם, צעדים ממוספרים, רגע שיא ומסלול כשל. כולן כאלה. נבדק גם אם יש מסע לכל משטח ב-site-map ולכל CAP שיש לו ממשק משתמש.

### Findings
- **major** אין מסע לרוב משטחי האדמין: לקוחות (חיפוש, סינון פעילה/לא פעילה, ייצוא CSV, הסרת פרטים CAP-30), מוצרים (CAP-3), תוכן האתר (CAP-27), הודעה כללית (CAP-32), יבוא לקוחות (CAP-31), יומן פעולות (CAP-26), הגדרות. זה סותר את רשומת ה-memlog "IA closure check done: all site-map surfaces covered by journeys". יבוא (CAP-31) והסרת פרטים (CAP-30) הם רב-שלביים ורגישים, ובלי מסע ה-story-dev ימציא אותם. (EXPERIENCE › Key Flows). *Fix:* להוסיף לפחות Flow 6 "טל מייבאת לקוחות קיימות ושולחת קישורי הפעלה" (תבנית → העלאה → דוח בדיקה → צ׳קבוקס → הפקת קישורים → רשימה עם וואטסאפ לכל לקוחה → הפקה מחדש לקישור שפג) ו-Flow 7 "טל מפרסמת גלריה/המלצה" (טיוטה → תצוגה מקדימה → סימון הסכמה לתמונה מזוהה → alt → פרסום). למשטחים הפשוטים (מוצרים, הודעה כללית, יומן, הגדרות) מספיקים מסעות מקוצרים. אחרת צריך לתקן את רשומת ה-memlog.
- **major** אין משטח לקישור איפוס סיסמה בצד הלקוחה. לפי CAP-7, טל שולחת "קישור איפוס חד-פעמי", ו-data-model מגדיר `activation_tokens.purpose = reset`. בטבלת המשטחים המשתמעים יש רק join ויבוא. (EXPERIENCE › IA › משטחים משתמעים; State Patterns). *Fix:* להוסיף משטח "קישור איפוס — תקף (סיסמה חדשה + אישור) / מומש / פג" ולהשלים את מסלול הכשל של "שכחתי סיסמה" עד כניסה מחדש.
- **minor** אין מסע לרכישה חוזרת של לקוחה קיימת (CAP-6: טל מוסיפה מוצר לחשבון, הלקוחה מקבלת התראת "רכישה חוזרת" ומסך עם ההודעה לפי סוג המוצר). (Key Flows). *Fix:* ענף ב-Flow 2 "לקוחה קיימת" + מה שהלקוחה רואה בבית.
- **minor** אין מסע להרשמה לבראנץ׳ זוגי (CAP-11): שני מקומות, זכות זוגית בלבד, `guest_details` ב-data-model. (Key Flows; Interaction Primitives). *Fix:* ענף קצר או שורה ב-Interaction Primitives שמסבירה מה מוצג ב-bottom-sheet לזוגי והאם נאספים פרטי המבוגרת השנייה.
- **minor** השיא של Flow 2, "התשלום אושר והקישור בדרך למיכל", מגיע לפני שטל באמת שלחה את הקישור (וואטסאפ רק נפתח). (Flow 2 צעדים 7–8). *Fix:* "התשלום אושר. הקישור מוכן לשליחה", וסטטוס "ממתין".
- **minor** אין מסע שמגיע ל"כניסות וכרטיסיות" (היסטוריית תנועות CAP-9) או לעמודים הציבוריים אודות, שאלות נפוצות, גלריה, מדיניות פרטיות והצהרת נגישות. (Key Flows). *Fix:* מספיק לציין ב-Flow 1 או 3 את המעבר, או לרשום אותם במפורש כמשטחים שנבנים מטבלאות ה-spine בלבד.

## 2. Token completeness — strong

נבדק: כל טוקן ב-frontmatter וכל הפניית `{path}` בפרוזה ובשני הקבצים. כולם מוגדרים, ולכל צבע יש hex. מצב בהיר בלבד, כך שאין צורך בזוגות dark. 15 יחסי ניגוד חושבו מחדש ותואמים בדיוק (ink/bg 13.28, accent/bg 3.42, on-primary/success 5.6, on-primary/error 6.1, warning/tint 4.64 ועוד).

### Findings
- **minor** לא הוגדר צבע הטקסט של מונה ההתראות ב-`bottom-tab-bar` ("label-strong על primary"). (DESIGN › Components › bottom-tab-bar). *Fix:* "`{colors.on-primary}` על `{colors.primary}` (8.46:1)".
- **minor** `status-chip` לא כולל וריאנט "עומדת לפוג". EXPERIENCE משתמש ב-`few-left` ו-DESIGN (balance-card) כותב "status-chip warning". (DESIGN › status-chip; EXPERIENCE › מצבי זכות). *Fix:* להוסיף וריאנט `expiring` (warning) או לאחד את השם בשני הקבצים.
- **minor** טבעת הפוקוס `2px {colors.primary}` מוגדרת בלי offset. על `button-primary` (מילוי primary) הטבעת לא תיראה בלי offset. (DESIGN › input.focusRing; EXPERIENCE › State Patterns › פוקוס). *Fix:* להגדיר `ring-offset 2px {colors.background}`.

## 3. Component coverage — adequate

נבדק: לכל 24 הרכיבים ב-frontmatter יש שורה ב-DESIGN › Components וגם ב-EXPERIENCE › Component Patterns. כולם מכוסים.

### Findings
- **major** ב-`top-bar` חסר כפתור התפריט. לפי ה-memlog (18:20), "Public nav: menu button in top bar opens Sheet", אבל המפרט החזותי מגדיר רק wordmark מימין ו"כניסה לאזור האישי" משמאל. לא מוגדרים מיקום הכפתור, האייקון, ה-aria-label, וגם לא מבנה ה-Sheet (צד פתיחה ב-RTL, קישורים, סגירה). (DESIGN › Components › top-bar; EXPERIENCE › Component Patterns › top-bar). *Fix:* להוסיף לשורת top-bar את כפתור התפריט (lucide `Menu`, 44px, aria-label "תפריט") ואת המיקום שלו ביחס ל-wordmark ולכפתור הכניסה. להוסיף שורה ל-`Sheet` הציבורי ב-Component Patterns.
- **minor** אין רכיב לכרטיס הסבר הפוש ולהדרכת התקנת PWA. EXPERIENCE מזכיר "כרטיס הסבר + כפתור", אבל לא ברור אם זה `card` או `inline-notice`. (EXPERIENCE › Interaction Primitives › פוש). *Fix:* לקבוע איזה רכיב משמש לכל אחד מהם.
- **minor** `Sonner`/Toast מופיע ב-DESIGN, אבל EXPERIENCE לא קובע מתי משתמשים בו לעומת `inline-notice` ו-`aria-live`. (DESIGN › Components פתיח; EXPERIENCE › Component Patterns). *Fix:* כלל אחד, למשל: toast רק לאישור לא-קריטי שמתבטל מעצמו, וחסימות ותוצאות כספיות תמיד ב-`inline-notice`.
- **minor** ב-`attendee-row` אין העדפות תזונה, אף שה-site-map (פרטי מפגש) דורש "אלרגיות והעדפות" ו-data-model כולל `dietary_preferences`. (DESIGN/EXPERIENCE › attendee-row; פאנל ניהול בטלפון). *Fix:* להוסיף שורת העדפות ב-`body-sm`.

## 4. State coverage — thin

נבדק: כל משטח ב-IA מול המצבים הרלוונטיים (טעינה, ריק, שגיאה, לא מקוון, הרשאה, חסימה). משטחי הלקוחה מכוסים היטב. משטחי האדמין נשענים רק על המצבים הכלליים.

### Findings
- **major** אין משטח או מצב לבחירה אחרי ביטול מצד העסק. לפי cancellation-rules, בביטול מצד העסק "הלקוחה בוחרת בין החזר לזיכוי". ב-EXPERIENCE כתוב רק "`status-chip` cancelled + התראה + אפשרויות". לא מוגדר איפה היא בוחרת, מה מוצג עד שבחרה, ומה קורה לכרטיסייה שפגה ("אם צריך, טל מאריכה ידנית"). (EXPERIENCE › מצבי מפגש › בוטל ע״י העסק). *Fix:* להגדיר שההתראה מובילה ל-bottom-sheet בחירה זהה לוריאנט א׳ של Flow 4, ולהגדיר את מצב "טרם נבחר". את שאלת המועד האחרון לבחירה לסמן כ-Open Question ולא להמציא אותו.
- **major** CAP-15 קובע "היא יכולה לעזוב את הרשימה", אבל אין ב-UX פעולה לעזיבת רשימת המתנה. ב-"ההרשמות שלי" מוצג רק chip `pending`. (EXPERIENCE › IA › ההרשמות שלי; מצבי הרשמה). *Fix:* להוסיף פעולה "לצאת מרשימת ההמתנה" (button-secondary, בלי חלון אישור) ולהוסיף אותה ל-Component Patterns ולמיקרו-קופי.
- **major** למשטחי אדמין אין מצבים משלהם: עורך תוכן (טיוטה / תצוגה מקדימה / פורסם / מוסתר, סימון הסכמה לתמונה מזוהה CAP-27, alt חובה), עורך מפגש (טיוטה / פורסם, שכפול), רישום ידני כשהמפגש מלא (CAP-14: "אי אפשר לחרוג מהמכסה בלי להעלות אותה קודם"), מוצר מוסתר, והודעה כללית (כל הלקוחות או רק פעילות, אישור לפני שליחה, מה קורה בשליחה חוזרת). (EXPERIENCE › State Patterns). *Fix:* להוסיף טבלה "מצבי אדמין" שממפה כל אחד מאלה למצב ולפעולה.
- **minor** אין מצב לבית של לקוחה בלי זכות פתוחה ובלי הרשמה עתידית, למשל אחרי שכל הכניסות נוצלו. (EXPERIENCE › IA › בית; State Patterns). *Fix:* `empty-state` עם פנייה לטל לרכישה.
- **minor** לא מוגדר מה קורה ב-"לא מקוון" באדמין. המצב הגלובלי מדבר רק על כפתורי הרשמה/ביטול, ולא על אישור תשלום או פעולות רגישות. (State Patterns › לא מקוון). *Fix:* "כל פעולה שמשנה נתונים disabled", גם באדמין.
- **minor** כשהתראה מקשרת ליעד שכבר לא קיים (מפגש שבוטל או הרשמה שבוטלה), לא מוגדר מה מוצג. (Component Patterns › notification-item). *Fix:* היעד מוצג עם סטטוס עדכני ו-`inline-notice`.
- **minor** ביטול הרשמה זוגית שמומנה בקיזוז מכרטיסייה "פותח טיפול ידני אצל טל" (cancellation-rules), אבל אין לזה מצב. (מצבי זכות ויתרה). *Fix:* שורה: אין בחירה עצמית, מוצג "טל תטפל בזה" + פנייה לטל.
- **minor** המיקרו-קופי של מצב לא מקוון, "ההרשמות והביטולים מחכים לחיבור", רומז שהפעולות נשמרות בתור ויישלחו אחר כך. זה סותר את "אין אישור בלי שרת" (CAP-23). (Voice › מיקרו-קופי › לא מקוון). *Fix:* "אי אפשר להירשם או לבטל בלי חיבור. כשהחיבור יחזור, אפשר לנסות שוב".

## 5. Visual reference coverage — adequate

קבצים: `imports/refrence-desing.md`, `.working/color-themes-1.html`, `.working/typography-1.html`, `.working/typography-2.html`, `.working/directions-1.html`. אין תיקיות `mockups/` או `wireframes/`. הכלל "ה-spine קובע בסתירה" מופיע בשני הקבצים.

### Findings
- **minor** `.working/typography-1.html` (4 הזוגות שנדחו) לא מקושר באף מקום. (DESIGN פתיח; EXPERIENCE › Inspiration). *Fix:* לקשר אותו תחת "נדחה" או להשאיר אותו מחוץ לקידום במכוון.
- **minor** לא רונדרו מוקאפים למסכי מפתח, ו-`.working/` לא קודם ל-`mockups/`. אחרי הקידום, הקישורים ל-`.working/` ב-DESIGN וב-EXPERIENCE יישברו. (DESIGN פתיח; EXPERIENCE › Inspiration). *Fix:* בשלב Finalize לרנדר מוקאפים (לפחות גיליון אישור הרשמה, מבט בוקר ובית לקוחה), לקדם אותם ולעדכן את הקישורים.

## 6. Bloat & overspecification — adequate

### Findings
- **minor** המיקרו-קופי ששוכפל מילה במילה מ-products-catalog (4 שורות) יכול לסטות מהמקור, וזה בניגוד להצהרה בראש EXPERIENCE ש"כללים עסקיים לא משוכפלים". (Voice › מיקרו-קופי). *Fix:* להפנות ל-products-catalog › "הודעה אחרי הצטרפות" ולא להעתיק את הטקסט.
- **minor** בבית האדמין "בקשות החזר" מופיעות פעמיים, גם בפריט 2 "לטיפול" וגם בפריט 3. (EXPERIENCE › IA › פאנל ניהול › בית). *Fix:* להחליט באיזה פריט הן מופיעות.
- **minor** ה-48 שעות מקודדות קשיח במיקרו-קופי ובזרימות, אבל לפי ה-site-map (הגדרות) "שינוי חלון ה-48 שעות הוא שינוי מדיניות שמוצג ללקוחות". (Voice › חסום; Interaction Primitives). *Fix:* להפוך למשתנה `{חלון ביטול}` ולציין שהערך מגיע מההגדרות.
- **minor** פעולת ה-CTA בהירו לא הוכרעה: "גולל/מנווט לעמוד הבראנצ׳ים". טבלת ה-IA מניחה ניווט. (Component Patterns › button-hero). *Fix:* לבחור אחת מהשתיים.

## 7. Inheritance discipline — adequate

נבדק: ה-`sources` מתפרקים לקבצים קיימים, שמות הרכיבים זהים בכל המקומות, והפניות הטוקנים ב-EXPERIENCE תואמות ל-DESIGN.

### Findings
- **major** בטבלת "חלון אישור רגיש" חסרות פעולות שהמקורות דורשים להן חלון אישור: שינוי חלופות זיכוי או הארכת זיכוי (cancellation-rules: "עם סיבה ועם חלון אישור"), ואישור יבוא עם צ׳קבוקס (CAP-31). (EXPERIENCE › חלון אישור רגיש). *Fix:* להוסיף שתי שורות עם תוכן תיבת ההשפעה, למשל "חלופות נוכחיות → חדשות + סיבה" ו-"X תקינות / Y שגויות / Z מתנגשות, יתרות שייווצרו".
- **minor** ב-Inspiration כתוב שמ-Ziona נלקח "כפתור צף עגול ליצירת קשר", אבל רשומת ה-memlog המאוחרת (change) החליפה את ה-FAB ב-`whatsapp-bar`. (EXPERIENCE › Inspiration & Anti-patterns). *Fix:* "כפתור צף עגול — הוחלף בפס תחתון מכיוון 2".
- **minor** EXPERIENCE ממפה רשימת המתנה למצב הרשמה `pending`, אבל ב-data-model רשימת ההמתנה היא ישות נפרדת (`waitlist_entries`). (EXPERIENCE › מצבי הרשמה). *Fix:* להפריד: מצבי הרשמה confirmed/cancelled, ורשימת המתנה כרשומה נפרדת עם chip pending.
- **minor** בראש EXPERIENCE כתוב "מונחים לפי `glossary.md`", אבל glossary.md לא מופיע ב-`sources`. (EXPERIENCE frontmatter). *Fix:* להוסיף אותו.
- **minor** ב-Accessibility כתוב "אין פעולה עם מגבלת זמן... מלבד תוקף קישור 48h", אבל יש גם חלון ביטול עצמי וסגירת הרשמה. (Accessibility Floor › זמן). *Fix:* לנסח "מגבלות הזמן היחידות הן כללי עסק שמוצגים מראש (קישור, חלון ביטול, סגירת הרשמה)".
- **minor** יש עשר הנחות מסומנות `[ASSUMPTION]` שלא מופיעות ב-Open Questions: `--ring`, `section-app`, `content-max`, נקודות שבירה, `rounded.lg`, empty-state בלי איור, הסתרת פס הוואטסאפ בהירו, פס הוואטסאפ לא מוצג באזור האישי, משך תנועה, והסרגל התחתון נשאר ב-lg. (DESIGN; EXPERIENCE). *Fix:* לעבור עליהן ב-Finalize: לאשר ולרשום ב-memlog, או להעביר ל-Open Questions.
- **minor** לא מוגדר מה לקוחה מחוברת רואה בעמוד מפגש ציבורי ובפס הוואטסאפ ("להצטרפות"). ה-IA מגדיר רק את חוויית האורחת. (EXPERIENCE › IA › עמוד מפגש; Component Patterns › whatsapp-bar). *Fix:* לקבוע אם לקוחה מחוברת מקבלת "להרשמה" ואם הפס מוסתר עבורה.

## 8. Shape fit — strong

DESIGN.md בסדר הקנוני המלא. ב-EXPERIENCE.md קיימים כל סעיפי החובה, וגם Responsive ו-Inspiration, שנדרשים כאן כי יש כמה משטחים ורפרנס. הסעיפים שנוספו ("חלון אישור רגיש", "פאנל ניהול בטלפון") מוצדקים. Open Questions עקביות עם תגיות ה-`[ASSUMPTION]` המקבילות. הרשימה "נסגרו" תואמת ל-memlog.

## Mechanical notes

- כל ההפניות `{colors.*}`, `{typography.*}`, `{rounded.*}`, `{spacing.*}` ו-`{components.*}` בשני הקבצים מתפרקות לטוקנים. `{typography.eyebrow}` מוגדר ולא משמש אף רכיב.
- שמות הרכיבים זהים בכל המקומות: frontmatter, טבלת DESIGN ו-Component Patterns (24/24).
- כל החלטות ה-memlog משתקפות. יוצאי דופן: רשומת ה-FAB ב-Inspiration (#7), ורשומת "IA closure" שאינה נכונה בפועל (#1).
- לא נמצאה סתירה ישירה לכלל עסקי ב-SPEC. כל הפערים הם חוסרים, לא כללים שהומצאו.
- שני הקבצים ב-`status: draft`. בשניהם אין תרשימי Mermaid.
