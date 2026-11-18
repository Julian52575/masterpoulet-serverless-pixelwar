import { initializeApp, getApps, type FirebaseApp } from 'firebase/app'
import { getFirestore, connectFirestoreEmulator, type Firestore } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'demo-api-key',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'local-project',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || 'demo-app-id',
}

const app: FirebaseApp = getApps().length > 0 ? getApps()[0]! : initializeApp(firebaseConfig)
const db: Firestore = getFirestore(app)

const emulatorHost = import.meta.env.VITE_FIRESTORE_EMULATOR_HOST
if (emulatorHost) {
  const [host = 'localhost', portStr = '8088'] = emulatorHost.split(':')
  connectFirestoreEmulator(db, host, Number(portStr))
}

export { app, db }
