import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, setUnauthorizedHandler } from './api';
import { setTimeZone } from './format';
import type { Me } from './types';

interface AuthValue {
  me: Me | null;
  loading: boolean;
  refresh: () => Promise<unknown>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider(props: { children: ReactNode }) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await api.get<Me>('/me');
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  useEffect(() => {
    setUnauthorizedHandler(() => {
      qc.setQueryData(['me'], null);
    });
  }, [qc]);

  useEffect(() => {
    if (query.data?.timezone) setTimeZone(query.data.timezone);
  }, [query.data]);

  const value: AuthValue = {
    me: query.data ?? null,
    loading: query.isLoading,
    refresh: () => query.refetch(),
    logout: async () => {
      await api.post('/logout').catch(() => undefined);
      qc.clear();
      qc.setQueryData(['me'], null);
    },
  };
  return <AuthContext.Provider value={value}>{props.children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
