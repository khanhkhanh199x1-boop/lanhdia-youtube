import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth';
import { getAuthInstance } from '../lib/firebase';
import {
  isMasterAdmin,
  buildMasterAdminProfile,
  computeReadOnly,
  type UserProfile,
} from '../lib/rbac';
import { apiGet } from '../lib/api-client';

// ============================================================================
// AuthContext (Mục 4).
// - Master Admin: ngay khi onAuthStateChanged trả user khớp -> gán profile
//   Master ngay (không chờ API), isReadOnly=false, không bao giờ rơi vào
//   fallback "Chủ Team"/"Chỉ xem". Sau đó vẫn gọi /api/auth/me để đồng bộ.
// - Tài khoản thường: gọi /api/auth/me (nguồn sự thật về role/isReadOnly).
// - assertWritable(): chặn thao tác ghi khi Read-Only (client chỉ vô hiệu nút).
// ============================================================================

interface AuthContextValue {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  isReadOnly: boolean;
  isRoot: boolean;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  assertWritable: () => boolean;
  refreshProfile: () => Promise<void>;
  profileError: string;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const [profileError, setProfileError] = useState('');
  const revision = useRef(0);
  const syncProfile = useCallback(async (u: User) => {
    const rev = ++revision.current;
    const current = () => revision.current === rev && getAuthInstance().currentUser?.uid === u.uid;
    try {
      const data = isMasterAdmin(u.uid, u.email, u.emailVerified)
        ? buildMasterAdminProfile(u) : await apiGet<UserProfile>('/api/auth/me');
      if (current()) {
        setProfile({ ...data, isReadOnly: computeReadOnly(data) });
        setProfileError('');
      }
    } catch {
      if (current()) {
        setProfile(null);
        setProfileError('Không xác định được quyền của tài khoản. Kiểm tra kết nối rồi thử lại.');
      }
    } finally {
      if (current()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(getAuthInstance(), (u) => {
      ++revision.current;
      setUser(u);
      setProfile(null);
      setProfileError('');
      setLoading(Boolean(u));
      if (u) void syncProfile(u);
    });
    return () => { ++revision.current; unsubscribe(); };
  }, [syncProfile]);

  const refreshProfile = useCallback(async () => {
    const current = getAuthInstance().currentUser;
    if (current) await syncProfile(current);
  }, [syncProfile]);

  useEffect(() => {
    if (!user) return;
    const syncIfVisible = () => { if (!document.hidden) void refreshProfile(); };
    window.addEventListener('focus', syncIfVisible);
    const timer = profile?.role === 'staff' ? window.setInterval(syncIfVisible, 60_000) : undefined;
    return () => { window.removeEventListener('focus', syncIfVisible); if (timer) window.clearInterval(timer); };
  }, [user, profile?.role, refreshProfile]);

  const signInWithGoogle = useCallback(async () => {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(getAuthInstance(), provider);
  }, []);

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    await signInWithEmailAndPassword(getAuthInstance(), email, password);
  }, []);

  const signUpWithEmail = useCallback(async (email: string, password: string) => {
    await createUserWithEmailAndPassword(getAuthInstance(), email, password);
  }, []);

  const signOut = useCallback(async () => {
    await firebaseSignOut(getAuthInstance());
    setProfile(null);
  }, []);

  const isReadOnly = useMemo(() => {
    if (!profile) return false;
    if (profile.role === 'root') return false; // Root KHÔNG BAO GIỜ read-only
    return profile.isReadOnly;
  }, [profile]);

  const isRoot = profile?.role === 'root';

  /** Trả về true nếu được ghi; nếu Read-Only thì báo và trả false. */
  const assertWritable = useCallback((): boolean => {
    if (isRoot) return true;
    if (isReadOnly) {
      window.alert(
        profile?.role === 'staff' ? 'Bạn đang có quyền chỉ xem.' : 'Tài khoản đang ở chế độ chỉ xem. Vui lòng nâng cấp hoặc gia hạn gói để tiếp tục.',
      );
      return false;
    }
    return true;
  }, [isRoot, isReadOnly, profile?.role]);

  const value: AuthContextValue = {
    user,
    profile,
    loading,
    isReadOnly,
    isRoot,
    signInWithGoogle,
    signInWithEmail,
    signUpWithEmail,
    signOut,
    assertWritable,
    refreshProfile,
    profileError,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth phải dùng trong AuthProvider');
  return ctx;
}
