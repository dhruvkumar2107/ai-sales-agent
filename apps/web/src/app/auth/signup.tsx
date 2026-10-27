import { signUp } from "@/lib/auth";
import { useState } from "react";

export default function SignUp() {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await signUp({ email, name });
      // Redirect to onboarding or dashboard
      ;(window as any).location.href = "/dashboard";
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-8">
      <div className="w-full max-w-md space-y-6 p-8 bg-card border rounded-lg shadow">
        <h2 className="text-2xl font-bold text-center">Create Account</h2>
        {error && <p className="text-red-600 text-center">{error}</p>}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full rounded-lg border py-2 px-3 focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full rounded-lg border py-2 px-3 focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <button
            type="submit"
            className="w-full rounded-lg border py-2 px-3 font-medium bg-primary text-white hover:bg-primary/90"
          >
            Sign Up
          </button>
        </form>
        {/** Temporary bypass - direct dashboard access **/}
        <p className="text-sm text-center mt-4">
          Already have an account? <a href="/auth/signin" className="underline text-primary cursor-pointer">Sign In</a>
        </p>
      </div>
    </div>
  );
}