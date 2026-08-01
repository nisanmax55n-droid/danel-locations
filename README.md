# מאגר מיקומים דנאל

מערכת מלאה לניהול אתרי עבודה ונקודות דיווח, בחלוקה לתחנות וקטעים.

## יכולות

- שער כניסה מאובטח בעיצוב מאגר 610/911.
- תפקידי בעלים ומנהל.
- הבעלים מוגן מהשבתה ומנהל את משתמשי המערכת.
- מנהלים יכולים להוסיף, לערוך ולמחוק מיקומים אך אינם מנהלים משתמשים.
- החלפת סיסמה חובה בכניסה הראשונה.
- מאגרי אתרי עבודה ונקודות דיווח.
- חלוקה לתחנות וקטעים.
- שם מיקום, ק״מ או טווח ק״מ, קישור Waze, קישור Google Maps, קואורדינטות והערות.
- חיפוש וסינון והתאמה מלאה לטלפון ולמחשב.
- FastAPI, React, PostgreSQL ו־Docker.

## פריסה ל־Railway בשלושה שירותים

שמות השירותים המומלצים: `Postgres`, `Backend`, `Frontend`.

### Backend

חבר את אותו מאגר GitHub והגדר את המשתנים:

- `RAILWAY_DOCKERFILE_PATH=Dockerfile.backend`
- `DATABASE_URL=${{Postgres.DATABASE_URL}}`
- `SECRET_KEY` — מחרוזת אקראית ארוכה.
- `BOOTSTRAP_USERNAME=owner`
- `BOOTSTRAP_PASSWORD` — סיסמה ראשונית חזקה.
- `ACCESS_TOKEN_HOURS=12`
- `CORS_ORIGINS=https://${{Frontend.RAILWAY_PUBLIC_DOMAIN}}`

צור לשירות Backend דומיין ציבורי. אין ליצור דומיין ציבורי ל־Postgres.

### Frontend

חבר את אותו מאגר GitHub והגדר:

- `RAILWAY_DOCKERFILE_PATH=Dockerfile.frontend`
- `VITE_API_URL=https://${{Backend.RAILWAY_PUBLIC_DOMAIN}}/api`

צור לשירות Frontend דומיין ציבורי. לאחר שינוי `VITE_API_URL` יש לבצע Redeploy, מפני שזה משתנה שנצרב בזמן בניית Vite.

### סדר הפריסה

1. פרוס Postgres.
2. פרוס Backend וצור לו דומיין.
3. פרוס Frontend וצור לו דומיין.
4. בצע Redeploy ל־Backend ול־Frontend לאחר שכל משתני ההפניה נשמרו.
5. בדוק `https://<backend-domain>/api/health`, ולאחר מכן פתח את דומיין ה־Frontend.

## הרצה מקומית

```bash
cp .env.example .env
docker build -t danel-locations .
docker run --env-file .env -p 8000:8000 danel-locations
```

לאחר מכן לפתוח `http://localhost:8000`.

## אבטחה

אין לשמור סיסמאות אמיתיות בקוד או ב־GitHub. הסיסמאות נשמרות במסד הנתונים כ־Argon2 hash, והכניסה משתמשת ב־JWT עם תוקף מוגבל.
