/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, jest } from '@jest/globals';
import React from 'react';

// Mock ReactDOM to prevent auto-rendering during import
jest.mock('react-dom/client', () => ({
    createRoot: jest.fn(() => ({
        render: jest.fn(),
        unmount: jest.fn(),
    })),
}));

import App from '../index';

describe('App Component', () => {
    describe('Component Import', () => {
        it('should successfully import App component', () => {
            expect(App).toBeDefined();
            expect(typeof App).toBe('function');
        });

        it('should be a React component class', () => {
            // Check if App is a class component by checking if it has prototype
            expect(App.prototype).toBeDefined();
            expect(App.prototype.render).toBeDefined();
            expect(typeof App.prototype.render).toBe('function');
        });
    });

    describe('Component Structure', () => {
        it('should have constructor that initializes state', () => {
            // Check for constructor
            expect(App.prototype.constructor).toBeDefined();

            // Create instance and check state
            const app = new App({});
            expect(app.state).toBeDefined();
            expect(app.state.code).toBeDefined();
            expect(typeof app.state.code).toBe('string');
            expect(app.state.breakpoints).toBeDefined();
            expect(app.state.breakpoints instanceof Set).toBe(true);
        });

        it('should have debugger control methods', () => {
            const app = new App({});

            // Check for essential debugger methods (using type assertion to access private methods)
            expect(typeof (app as any).run).toBe('function');
            expect(typeof (app as any).stop).toBe('function');
            expect(typeof (app as any).step).toBe('function');
            expect(typeof (app as any).pause).toBe('function');
            expect(typeof (app as any).reset).toBe('function');
        });
    });
});
