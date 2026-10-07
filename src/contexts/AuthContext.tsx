import React, { createContext, useContext, useState, useEffect } from 'react';
import { 
  auth, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut as firebaseSignOut, 
  onAuthStateChanged,
  signInAnonymously,
  syncUserProfileToFirestore,
  fetchUserProfileFromFirestore,
  User,
  FirestoreUserProfile
} from '../lib/firebase';
import { updateStoredProfile } from '../lib/userSettings';

interface AuthContextType {
  currentUser: User | null;
  userProfile: FirestoreUserProfile | null;
  loading: boolean;
  login: (email: string, pass: string) => Promise<{ success: boolean; profile?: FirestoreUserProfile | null; error?: string }>;
  register: (email: string, pass: string, profileData: Partial<FirestoreUserProfile>) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<FirestoreUserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!isMounted) return;
      setCurrentUser(user);

      if (user) {
        try {
          // Fetch or hydrate user profile from Firestore
          const profile = await fetchUserProfileFromFirestore(user.uid);
          if (profile && isMounted) {
            setUserProfile(profile);
            // Sync with local state safely
            updateStoredProfile({
              fullName: profile.fullName || user.displayName || (user.email ? user.email.split('@')[0] : 'Citizen'),
              displayName: profile.displayName || user.displayName || (user.email ? user.email.split('@')[0] : 'Citizen'),
              email: profile.email || user.email || '',
              bloodType: profile.bloodType || 'O+',
              birthdate: profile.birthdate || '1998-01-01',
              heightCm: profile.heightCm || 175,
              weightKg: profile.weightKg || 70,
              ...(profile.emergencyContact ? { emergencyContact: profile.emergencyContact } : {}),
              ...(Array.isArray(profile.emergencyCircle) ? { emergencyCircle: profile.emergencyCircle } : {})
            });
          }
        } catch (err) {
          console.warn('[AuthContext] Firestore profile fetch notice:', err);
        }
      } else {
        if (isMounted) setUserProfile(null);
      }

      if (isMounted) setLoading(false);
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  const login = async (email: string, pass: string): Promise<{ success: boolean; profile?: FirestoreUserProfile | null; error?: string }> => {
    try {
      const cred = await signInWithEmailAndPassword(auth, email.trim(), pass);
      
      let profile: FirestoreUserProfile | null = null;
      try {
        const cached = localStorage.getItem(`serd_user_profile_${cred.user.uid}`);
        if (cached) profile = JSON.parse(cached);
      } catch {}

      try {
        const remoteProfile = await fetchUserProfileFromFirestore(cred.user.uid);
        if (remoteProfile) {
          profile = remoteProfile;
          try {
            localStorage.setItem(`serd_user_profile_${cred.user.uid}`, JSON.stringify(remoteProfile));
            if (remoteProfile.role) localStorage.setItem('serd_current_user_role', remoteProfile.role);
          } catch {}
        }
      } catch (err) {
        console.warn('[AuthContext] Firestore profile fetch notice:', err);
      }

      if (profile) {
        setUserProfile(profile);
      }
      return { success: true, profile };
    } catch (err: any) {
      console.warn('[Firebase Auth] Login error:', err.code, err.message);
      let errorMsg = 'Failed to sign in. Please verify your credentials.';
      if (err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        errorMsg = 'Invalid email or password.';
      } else if (err.code === 'auth/operation-not-allowed') {
        errorMsg = 'Email/Password sign-in is not enabled in Firebase Console. Please verify Authentication settings.';
      }
      return { success: false, error: errorMsg };
    }
  };

  const register = async (email: string, pass: string, profileData: Partial<FirestoreUserProfile>) => {
    try {
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), pass);
      const newProfile: FirestoreUserProfile = {
        uid: cred.user.uid,
        email: email.trim(),
        fullName: profileData.fullName || 'Registered Citizen',
        displayName: profileData.displayName || profileData.fullName?.split(' ')[0] || 'Citizen',
        bloodType: profileData.bloodType || 'O+',
        birthdate: profileData.birthdate || '1995-01-01',
        heightCm: profileData.heightCm || 175,
        weightKg: profileData.weightKg || 70,
        allergies: profileData.allergies || [],
        role: profileData.role || 'citizen',
        ...(profileData.emergencyContact ? { emergencyContact: profileData.emergencyContact } : {}),
        ...(Array.isArray(profileData.emergencyCircle) ? { emergencyCircle: profileData.emergencyCircle } : {}),
        ...(profileData.agency ? { agency: profileData.agency } : {}),
        ...(profileData.badgeNumber ? { badgeNumber: profileData.badgeNumber } : {}),
        ...(profileData.responderRole ? { responderRole: profileData.responderRole } : {}),
        ...(profileData.station ? { station: profileData.station } : {}),
        ...(profileData.vehicleUnit ? { vehicleUnit: profileData.vehicleUnit } : {}),
        ...(profileData.callSign ? { callSign: profileData.callSign } : {}),
        ...(profileData.avatarUrl ? { avatarUrl: profileData.avatarUrl } : {})
      };

      await syncUserProfileToFirestore(newProfile);
      setUserProfile(newProfile);
      try {
        localStorage.setItem(`serd_user_profile_${cred.user.uid}`, JSON.stringify(newProfile));
        localStorage.setItem('serd_current_user_role', newProfile.role);
      } catch {}
      return { success: true };
    } catch (err: any) {
      console.warn('[Firebase Auth] Register error:', err.code, err.message);
      let errorMsg = 'Registration failed. Please try again.';
      if (err.code === 'auth/email-already-in-use') {
        errorMsg = 'This email address is already in use.';
      } else if (err.code === 'auth/weak-password') {
        errorMsg = 'Password should be at least 6 characters.';
      } else if (err.code === 'auth/operation-not-allowed') {
        errorMsg = 'Account registration via password is not enabled. Please verify Authentication settings.';
      }
      return { success: false, error: errorMsg };
    }
  };

  const logout = async () => {
    try {
      await firebaseSignOut(auth);
    } catch (err) {
      console.warn('[Firebase Auth] Sign out error:', err);
    }
    setCurrentUser(null);
    setUserProfile(null);
    try {
      localStorage.removeItem('serd_current_user_role');
    } catch {}
  };

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        userProfile,
        loading,
        login,
        register,
        logout
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
