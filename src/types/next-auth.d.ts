import 'next-auth';

declare module 'next-auth' {
  interface User {
    id: string;
    role: string;
    nameEn?: string;
    permissions: { screen: string; accessLevel: string }[];
  }

  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
      role: string;
      nameEn?: string;
      permissions: { screen: string; accessLevel: string }[];
    };
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string;
    role: string;
    nameEn?: string;
    permissions: { screen: string; accessLevel: string }[];
  }
}
