import {createContext, useContext, useEffect, useState} from "react";
import {User, signOut, signInWithCustomToken, onAuthStateChanged} from "firebase/auth";
import {auth} from '../firebaseClient';
import {api} from '../api';
import {getRefreshToken, clearRefreshToken} from './tokenStore';

type AuthContextType = {
    user: User | null;
    token: string | null;
    loading: boolean;
    login: (phone: string, password: string) => Promise<void>;
    register: (phone: string, password: string) => Promise<{ userId: string }>;
    signInWithToken: (customToken: string) => Promise<void>;
    logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | null>(null);

/** Build a lightweight mock Firebase User object when running in zero-credential local mock mode */
function buildMockFirebaseUser(customToken: string): User {
    const uid = customToken.replace("mock-custom-token-", "") || "mock-user-john-senior";
    return {
        uid,
        email: "mock-user@aipeer.local",
        phoneNumber: "+15555555555",
        displayName: "John Senior",
        emailVerified: true,
        isAnonymous: false,
        metadata: {},
        providerData: [],
        refreshToken: "",
        tenantId: null,
        delete: async () => {},
        getIdToken: async () => customToken,
        getIdTokenResult: async () => ({} as any),
        reload: async () => {},
        toJSON: () => ({ uid }),
        providerId: "custom",
    } as unknown as User;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [token, setToken] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    // On mount: try to restore session from refresh token in AsyncStorage
    useEffect(() => {
        let cancelled = false;

        const restoreSession = async () => {
            console.log('[Auth] Checking secure store for refresh token...');
            try {
                // reads from SecureStore, migrating any legacy AsyncStorage
                // value on first run after the upgrade (see tokenStore.ts)
                const refreshToken = await getRefreshToken();

                if (!refreshToken) {
                    console.log('[Auth] No refresh token found, showing login screen');
                    if (!cancelled) setLoading(false);
                    return;
                }

                console.log('[Auth] Found refresh token, calling /auth/refresh...');
                const res = await api.refresh(refreshToken);

                console.log('[Auth] Got fresh custom token, signing into Firebase...');
                if (res.customToken.startsWith('mock-custom-token-')) {
                    const mockUser = buildMockFirebaseUser(res.customToken);
                    if (!cancelled) {
                        setUser(mockUser);
                        setToken(res.customToken);
                        console.log('[Auth] Mock session restored successfully');
                    }
                } else {
                    const cred = await signInWithCustomToken(auth, res.customToken);

                    if (!cancelled) {
                        const idToken = await cred.user.getIdToken();
                        setUser(cred.user);
                        setToken(idToken);
                        console.log('[Auth] Session restored successfully');
                    }
                }
            } catch (e: any) {
                console.log('[Auth] Refresh failed:', e.message || e);
                // Token expired or invalid — clear it
                await clearRefreshToken();
                if (!cancelled) {
                    setUser(null);
                    setToken(null);
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        restoreSession();

        // Also listen for ongoing auth changes (e.g. sign out)
        const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
            if (firebaseUser) {
                setUser(firebaseUser);
                const idToken = await firebaseUser.getIdToken();
                setToken(idToken);
            }
        });

        return () => {
            cancelled = true;
            unsubscribe();
        };
    }, []);

    const signInWithToken = async (customToken: string): Promise<void> => {
        if (customToken.startsWith('mock-custom-token-')) {
            const mockUser = buildMockFirebaseUser(customToken);
            setUser(mockUser);
            setToken(customToken);
            return;
        }
        const cred = await signInWithCustomToken(auth, customToken);
        const idToken = await cred.user.getIdToken();
        setUser(cred.user);
        setToken(idToken);
    };

    const login = async (phone: string, password: string): Promise<void> => {
        const response = await api.login(phone, password);
        await signInWithToken(response.customToken);
    };

    const register = async (phone: string, password: string): Promise<{ userId: string }> => {
        const response = await api.createAccount(phone, password);
        return { userId: response.userId };
    };

    const logout = async (): Promise<void> => {
        console.log('[Auth] Logging out, clearing refresh token...');
        await clearRefreshToken();
        setUser(null);
        setToken(null);
        try {
            await signOut(auth);
        } catch {}
    };

    return (
        <AuthContext.Provider value={{ user, token, loading, login, register, signInWithToken, logout }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within AuthProvider');
    }
    return context;
}
