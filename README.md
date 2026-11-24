# Al Akhtari General Store ERP: setup

Static site (GitHub Pages) + Firebase (Auth, Firestore, one Cloud Function).

## 1. Firebase project
1. Create a project in the Firebase Console.
2. Authentication > Sign-in method > enable **Email/Password**.
3. Firestore Database > create (production mode).
4. Project settings > Your apps > add a **Web app**. Copy the config into `js/firebase-config.js`.
5. Install the rules: `firebase deploy --only firestore:rules` (or paste `firestore.rules` into the Rules tab).

## 2. Profit Cloud Function
Cloud Functions need the Blaze (pay-as-you-go) plan. Small shops usually stay within the free allowance.
```
cd functions && npm install && cd ..
firebase deploy --only functions
```
Without this function, sales still save, but no profit is recorded.

## 3. First admin
1. Authentication > Users > Add user, e.g. `owner@akhtari.local` with a password of 6+ characters. Copy its **UID**.
2. Firestore > create collection `users`, document ID = that UID, with fields:
   `username` (string, e.g. `owner`), `name` (string), `initial` (string, e.g. `O`), `role` (string `admin`), `active` (boolean `true`), `blockedUntil` (null).
3. Open the site and log in with username `owner` and your password.
4. Products page > "Load the 12 products from the workbook".

## 4. Adding staff
Repeat step 3 for each person (create the login, then the `users` document with their UID), or use User Management after the first admin is in.

## 5. Publish on GitHub Pages
Push this folder to a GitHub repository, then Settings > Pages > Deploy from branch > `main`, root folder.

## Notes
- Usernames map to `username@akhtari.local` logins. The domain is internal and receives no email.
- Profit = (retail price minus cost) for product lines. Charges and tax are not counted as profit.
- Reports, Profit History and product editing are not included in this build.
