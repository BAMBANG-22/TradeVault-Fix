import assert from 'node:assert';
import {
  THEME_STORAGE_KEY,
  getStoredTheme,
  setStoredTheme,
  applyThemeToDocument,
} from '../src/utils/theme';

// Mock browser environment for unit testing in Node/tsx
class LocalStorageMock {
  private store: Record<string, string> = {};

  getItem(key: string): string | null {
    return this.store[key] ?? null;
  }

  setItem(key: string, value: string): void {
    this.store[key] = String(value);
  }

  removeItem(key: string): void {
    delete this.store[key];
  }

  clear(): void {
    this.store = {};
  }
}

class DOMClassListMock {
  private classes = new Set<string>();

  add(cls: string) {
    this.classes.add(cls);
  }

  remove(cls: string) {
    this.classes.delete(cls);
  }

  contains(cls: string): boolean {
    return this.classes.has(cls);
  }
}

const mockLocalStorage = new LocalStorageMock();
const mockClassList = new DOMClassListMock();
let mockMetaContent = '';

(global as any).localStorage = mockLocalStorage;
(global as any).window = {
  dispatchEvent: () => true,
  localStorage: mockLocalStorage,
};
(global as any).CustomEvent = class {
  detail: any;
  constructor(public type: string, opts?: { detail: any }) {
    this.detail = opts?.detail;
  }
};
(global as any).document = {
  documentElement: {
    classList: mockClassList,
    style: { colorScheme: '' },
  },
  querySelector: (sel: string) => {
    if (sel === 'meta[name="theme-color"]') {
      return {
        setAttribute: (_attr: string, val: string) => {
          mockMetaContent = val;
        },
      };
    }
    return null;
  },
};

console.log('--- TEST THEME POLISH & DATA ISOLATION ---');

// Test 1: Default theme fallback
mockLocalStorage.clear();
const defaultTheme = getStoredTheme();
assert.strictEqual(defaultTheme, 'dark', 'Theme should default to dark when no storage key exists');
console.log('✓ Test 1 Passed: Theme defaults to dark');

// Test 2: Invalid storage fallback
mockLocalStorage.setItem(THEME_STORAGE_KEY, 'invalid_mode');
assert.strictEqual(getStoredTheme(), 'dark', 'Invalid theme value should gracefully fallback to dark');
console.log('✓ Test 2 Passed: Invalid storage gracefully falls back to dark');

// Test 3: Set and read Light theme
setStoredTheme('light');
assert.strictEqual(mockLocalStorage.getItem(THEME_STORAGE_KEY), 'light', 'Theme should be stored as light');
assert.strictEqual(getStoredTheme(), 'light', 'getStoredTheme should read light');
console.log('✓ Test 3 Passed: Theme can be set and retrieved as light');

// Test 4: Document theme class application for Light mode
applyThemeToDocument('light');
assert.strictEqual(mockClassList.contains('light'), true, 'Document should have .light class in light mode');
assert.strictEqual(mockClassList.contains('dark'), false, 'Document should NOT have .dark class in light mode');
assert.strictEqual(mockMetaContent, '#F5F7FA', 'Meta theme-color should match light background');
console.log('✓ Test 4 Passed: Light theme class and meta theme-color applied correctly');

// Test 5: Document theme class application for Dark mode
applyThemeToDocument('dark');
assert.strictEqual(mockClassList.contains('dark'), true, 'Document should have .dark class in dark mode');
assert.strictEqual(mockClassList.contains('light'), false, 'Document should NOT have .light class in dark mode');
assert.strictEqual(mockMetaContent, '#080A0E', 'Meta theme-color should match dark background');
console.log('✓ Test 5 Passed: Dark theme class and meta theme-color applied correctly');

// Test 6: Strict Isolation from Financial Settings and Trades
mockLocalStorage.setItem('tradevault_settings_v1', JSON.stringify({ startingBalance: 50000 }));
mockLocalStorage.setItem('tradevault_trades_v1', JSON.stringify([{ id: 'TRD-TEST-1', netProfit: 250 }]));

setStoredTheme('light');
setStoredTheme('dark');

const settingsRaw = mockLocalStorage.getItem('tradevault_settings_v1');
const tradesRaw = mockLocalStorage.getItem('tradevault_trades_v1');

assert.strictEqual(
  JSON.parse(settingsRaw!).startingBalance,
  50000,
  'Financial settings must remain intact and completely isolated from theme updates'
);
assert.strictEqual(
  JSON.parse(tradesRaw!)[0].id,
  'TRD-TEST-1',
  'Trades data must remain intact and completely isolated from theme updates'
);
console.log('✓ Test 6 Passed: Complete storage isolation verified between theme and financial/trade data');

console.log('\nAll Theme and UI Polish unit tests PASSED successfully!');
