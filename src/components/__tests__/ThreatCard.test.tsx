import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import ThreatCard from '../ThreatCard';

describe('ThreatCard UI Component', () => {
  it('should render PDS strobe effect and TAKE COVER NOW for direct hit emergencies', () => {
    const mockAlert = {
      id: '123',
      event: 'TORNADO WARNING',
      areaDesc: 'Cleveland, OK',
      expires: new Date(Date.now() + 3600000).toISOString(),
      threatLevel: 'Extreme' as const,
      severity: 'Extreme',
      isDirectHit: true,
      minDist: 0,
      headedTowards: true,
      keywords: { emergency: true, pds: true },
      headline: 'PARTICULARLY DANGEROUS SITUATION',
      description: 'A large and destructive tornado...',
      geometry: { type: 'Polygon', coordinates: [] },
      geometryCoordinates: [],
    };
    
    const { container } = render(<ThreatCard alert={mockAlert as any} hasAssets={true} />);
    
    // Assert PDS Strobe class exists
    expect(container.firstChild).toHaveClass('strobe-pds-active');
    expect(container.firstChild).toHaveClass('border-red-600');
    expect(screen.getByText('TAKE COVER NOW')).toBeInTheDocument();
  });

  it('should downgrade styling for WATCH alerts', () => {
    const mockAlert = {
      id: '124',
      event: 'TORNADO WATCH',
      areaDesc: 'Oklahoma, OK',
      expires: new Date(Date.now() + 7200000).toISOString(),
      threatLevel: 'Moderate' as const,
      severity: 'Moderate',
      isDirectHit: true, // Assuming the user is inside the watch box
      minDist: 0,
      headedTowards: false,
      keywords: {},
      headline: 'CONDITIONS ARE FAVORABLE',
      description: '...',
      geometry: null,
      geometryCoordinates: [],
    };
    
    const { container } = render(<ThreatCard alert={mockAlert as any} hasAssets={true} />);
    
    // Should NOT have red warning classes
    expect(container.firstChild).not.toHaveClass('border-red-500');
    // Should have yellow/amber watch classes
    expect(container.firstChild).toHaveClass('border-yellow-500/40');
    expect(screen.getByText('PREPARE IN ADVANCE')).toBeInTheDocument();
  });

  it('should display TAKE SHELTER SOON for approaching threats', () => {
    const mockAlert = {
      id: '125',
      event: 'TORNADO WARNING', // Must be tornado to trigger TAKE SHELTER SOON
      areaDesc: 'McClain, OK',
      expires: new Date(Date.now() + 1800000).toISOString(),
      threatLevel: 'High' as const,
      severity: 'Severe',
      isDirectHit: false,
      minDist: 20, // Inside proximity warning threshold
      headedTowards: true, // Storm is headed towards asset
      keywords: {},
      headline: '',
      description: '...',
      geometry: { type: 'Polygon', coordinates: [] },
      geometryCoordinates: [],
    };
    
    render(<ThreatCard alert={mockAlert as any} hasAssets={true} />);
    
    // Assert distance logic UI
    expect(screen.getByText('TAKE SHELTER SOON')).toBeInTheDocument();
  });
});
