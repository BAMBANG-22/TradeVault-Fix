import { runFinancialCalculationsTests } from '../src/utils/testRunner';

console.log('=====================================================');
console.log('🚀 Menjalankan Pengujian Otomatis Perhitungan Finansial');
console.log('   TradeVault Journal - Validasi Metrik & Risiko');
console.log('=====================================================\n');

const suite = runFinancialCalculationsTests();

let currentCategory = '';
suite.results.forEach((test, idx) => {
  if (test.category !== currentCategory) {
    currentCategory = test.category;
    console.log(`\n📌 [KATEGORI]: ${currentCategory}`);
    console.log('-----------------------------------------------------');
  }

  const icon = test.passed ? '✅ PASS' : '❌ FAIL';
  console.log(
    `${icon} [${idx + 1}/${suite.total}] ${test.name}`
  );
  if (!test.passed) {
    console.log(`   Diharapkan: ${test.expected}, Didapatkan: ${test.actual}`);
  }
});

console.log('\n=====================================================');
console.log('📊 RINGKASAN HASIL PENGUJIAN');
console.log('=====================================================');
console.log(`Total Pengujian : ${suite.total}`);
console.log(`Berhasil (Pass) : ${suite.passed}`);
console.log(`Gagal (Fail)    : ${suite.failed}`);
console.log(`Waktu Eksekusi  : ${suite.durationMs}ms`);
console.log('Status          : ' + (suite.failed === 0 ? '✨ SEMUA PENGUJIAN LULUS (100% SUKSES)' : '⚠️ TERDAPAT KEGAGALAN'));
console.log('=====================================================\n');

if (suite.failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
