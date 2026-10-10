/**
 * Shared Firebase Auth init. Login and signup persist with
 * browserLocalPersistence (localStorage). getAuth() on the app screens
 * defaults to IndexedDB, so a just-signed-in user looks logged out and
 * those pages bounce them back to login.html.
 */
import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js';
import {
  initializeAuth,
  getAuth,
  browserLocalPersistence,
  browserPopupRedirectResolver
} from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js';

export var QG_FIREBASE_CONFIG = {
  apiKey: 'AIzaSyBbYJxU-3r7qVMqwzXHiC-qRkZNtmGobm0',
  authDomain: 'quickgigs-7b12d.firebaseapp.com',
  projectId: 'quickgigs-7b12d',
  storageBucket: 'quickgigs-7b12d.firebasestorage.app',
  messagingSenderId: '698985399366',
  appId: '1:698985399366:web:8a3ca60c5f3ffac84bb647'
};

export function qgInitAuth() {
  var app = getApps().length ? getApps()[0] : initializeApp(QG_FIREBASE_CONFIG);
  var auth;
  try {
    auth = initializeAuth(app, {
      persistence: browserLocalPersistence,
      popupRedirectResolver: browserPopupRedirectResolver
    });
  } catch (err) {
    auth = getAuth(app);
  }
  window._auth = auth;
  return auth;
}
