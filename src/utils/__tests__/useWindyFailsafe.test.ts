import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useWindyFailsafe } from '../useWindyFailsafe';

describe('useWindyFailsafe Hook', () => {
  it('should initialize successfully and allow map mode transitions without triggering fallback when Windy exists', () => {
    // Mock the windyStore (just an empty object so it's truthy)
    const mockWindyStore = {};
    const mockOnMapModeChange = vi.fn();
    const mockMapRef = { current: { setView: vi.fn(), getCenter: vi.fn(() => ({ lat: 0, lng: 0 })), getZoom: vi.fn(() => 5) } };

    const { result } = renderHook(() => useWindyFailsafe(mockWindyStore, mockOnMapModeChange, mockMapRef));

    // Initially no notification
    expect(result.current.notification).toBeNull();

    // Transition to wind mode
    act(() => {
      result.current.transitionMapMode('wind');
    });

    // Should call the passed callback and NOT trigger a failsafe notification
    expect(mockOnMapModeChange).toHaveBeenCalledWith('wind');
    expect(result.current.notification).toBeNull();
  });

  it('should trigger fallback notification and capture map state when Windy API is missing', () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    
    // Pass null for windyStore to simulate failure
    const mockOnMapModeChange = vi.fn();
    const mockMapRef = { current: { setView: vi.fn(), getCenter: vi.fn(() => ({ lat: 35, lng: -95 })), getZoom: vi.fn(() => 8) } };
    
    const { result } = renderHook(() => useWindyFailsafe(null, mockOnMapModeChange, mockMapRef));

    act(() => {
      result.current.transitionMapMode('satellite');
    });

    // Failsafe should trigger a warning
    expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('Windy API store is not available'));
    
    // It should set the fallback notification
    expect(result.current.notification).not.toBeNull();
    expect(result.current.notification?.targetMode).toBe('satellite');
    expect(result.current.notification?.visible).toBe(true);
    
    // It should still call the transition callback to update local state
    expect(mockOnMapModeChange).toHaveBeenCalledWith('satellite');

    consoleWarnSpy.mockRestore();
  });
});
