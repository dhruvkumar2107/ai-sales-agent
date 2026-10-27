import { createContext, useContext, useState, ReactNode } from "react";

type User = {
  id: string;
  name: string;
  email: string;
  role: "owner" | "sales_manager" | "sales_executive" | "service_advisor";
  orgId: string;
};

type AuthContextType = {
  user: User | null;
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, name: string) => Promise<void>;
  signOut: () => void;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const signIn = async (email: string, password: string) => {
    // Mock sign-in - in production, this would call Firebase Auth
    setUser({
      id: "user_1",
      name: "Dealership Owner",
      email: email,
      role: "owner",
      orgId: "org_1",
    });
    setIsLoading(false);
  };

  const signUp = async (email: string, name: string) => {
    // Mock sign-up - in production, this would create a Firebase user
    setUser({
      id: "user_2",
      name: name,
      email: email,
      role: "owner",
      orgId: "org_1",
    });
    setIsLoading(false);
  };

  const signOut = () => {
    setUser(null);
  };

  if (isLoading) {
    return <div>Loading...</div>;
  }

  return (
    <AuthContext.Provider value={{ user, isLoading: false, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};