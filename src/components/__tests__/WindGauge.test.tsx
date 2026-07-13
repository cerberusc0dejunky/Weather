import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import WindGauge from '../WindGauge';

describe('WindGauge Component', () => {
  it('should render DESTRUCTIVE WIND GUSTS styling when gust exceeds 80 MPH', () => {
    // Normal wind is 20, but gust is 90
    render(<WindGauge windSpeed={20} windGust={90} />);
    
    // Check that Destructive wording is displayed
    expect(screen.getByText(/DESTRUCTIVE WIND GUSTS/i)).toBeInTheDocument();
  });

  it('should render calm styles for low winds', () => {
    render(<WindGauge windSpeed={10} windGust={15} />);
    
    // Should display normal text, NOT destructive
    expect(screen.queryByText(/DESTRUCTIVE WIND GUSTS/i)).not.toBeInTheDocument();
  });
});
