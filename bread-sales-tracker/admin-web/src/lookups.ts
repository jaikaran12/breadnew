import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import type { Area, Driver, Product } from './types';

export function useAreas() {
  return useQuery({ queryKey: ['areas'], queryFn: () => api.get<{ areas: Area[] }>('/areas'), select: (d) => d.areas });
}

export function useDrivers() {
  return useQuery({ queryKey: ['drivers'], queryFn: () => api.get<{ drivers: Driver[] }>('/drivers'), select: (d) => d.drivers });
}

export function useProducts() {
  return useQuery({ queryKey: ['products'], queryFn: () => api.get<{ products: Product[] }>('/products'), select: (d) => d.products });
}
