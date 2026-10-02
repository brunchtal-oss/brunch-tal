// System microcopy of the admin screens. Amounts arrive formatted by
// lib/money.ts ("472 ₪"), dates by lib/time.ts.

export const adminCopy = {
  payments: {
    newTitle: "הוספת תשלום",
    newCustomer: "לקוחה חדשה",
    product: "מוצר",
    amount: "סכום ששולם",
    amountFromProduct: (amount: string) => `מהמוצר: ${amount}`,
    paidOn: "תאריך רכישה",
    method: "אמצעי תשלום",
    more: "פרטים נוספים (לא חובה)",
    reference: "אסמכתה (לא חובה)",
    note: "הערה (לא חובה)",
    preview: "מה ייווצר",
    previewUnits: (product: string, units: number) =>
      `${product} · ${units} כניסות`,
    previewExpires: "בתוקף עד",
    previewLink: "אחרי האישור ייווצר קישור הצטרפות חד-פעמי (48 שעות)",
    submit: "אישור תשלום ויצירת קישור",
    success: "התשלום אושר. הקישור מוכן לשליחה",
    // A repeat with the same key: the raw link is returned only once (AD-10).
    linkNotShown:
      "התשלום כבר אושר, ואת הקישור אי אפשר להציג שוב. קישור חלופי, בלי תשלום נוסף, יתאפשר במסך הקישורים",
    linkTitle: "לקוחה חדשה · הקישור מחכה להצטרפות",
    linkPending: "ממתין למימוש",
    linkValidUntil: "תקף עד",
    linkOnce: "לשימוש פעם אחת. פתיחה לא צורכת אותו",
    sendWhatsapp: "שליחה בוואטסאפ",
    copyLink: "העתקת הקישור",
    copied: "הקישור הועתק",
    another: "להוספת תשלום נוסף",
  },
} as const
