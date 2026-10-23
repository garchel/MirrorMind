# Recalibracao da confianca (estimativa offline)

Fonte: `C:\Users\paulo\OneDrive\Documentos\MirrorMind\docs\jev-eval-report.json`. Casos: 23.

> **Este numero estima, nao valida.** O ajuste e feito nos mesmos 23 casos,
> com validacao leave-one-out. O intervalo de confianca e largo; o resultado
> serve para decidir se vale investir em recalibracao, nao para afirmar que o
> gate passaria em producao.

| Metodo | ECE (LOO) |
| --- | ---: |
| Nenhuma (baseline) | 0.153 |
| Temperatura (LOO) | 0.155 |
| Isotonica (LOO) | 0.163 |

## Ponto de operacao sem recalibrar (massa decide)

| Limiar de massa | Respondidos | Acerto entre os respondidos |
| ---: | ---: | ---: |
| 0.00 | 23 de 23 | 91.3% |
| 0.55 | 22 de 23 | 90.9% |
| 0.70 | 18 de 23 | 100.0% |
| 0.85 | 12 de 23 | 100.0% |
