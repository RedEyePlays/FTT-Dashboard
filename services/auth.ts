
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth } from './firebase';

export function onAuthChange(callback: (user: User | null) => void) {
  return onAuthStateChanged(auth, callback);
}
