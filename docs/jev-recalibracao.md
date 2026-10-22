# Recalibracao da confianca (estimativa offline)

Fonte: `C:\Users\paulo\OneDrive\Documentos\MirrorMind\docs\jev-eval-report.json`. Casos: 23.

> **Este numero estima, nao valida.** O ajuste e feito nos mesmos 23 casos,
> com validacao leave-one-out. O intervalo de confianca e largo; o resultado
> serve para decidir se vale investir em recalibracao, nao para afirmar que o
> gate passaria em producao.

| Metodo | ECE (LOO) |
| --- | ---: |
| Nenhuma (baseline) | 0.120 |
| Temperatura (LOO) | 0.074 |
| Isotonica (LOO) | 0.163 |

## Ponto de operacao sem recalibrar (massa decide)

| Limiar de massa | Respondidos | Acerto entre os respondidos |
| ---: | ---: | ---: |
| 0.00 | 23 de 23 | 91.3% |
| 0.55 | 23 de 23 | 91.3% |
| 0.70 | 17 de 23 | 100.0% |
| 0.85 | 14 de 23 | 100.0% |
