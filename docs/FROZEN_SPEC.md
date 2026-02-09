# RoboChess — FrozenSpec (Source of Truth)

**Version:** 0.1  
**Date:** 2025-12-24  
**Status:** FROZEN (зміни — тільки через change request)

---

## 0. Цілі MVP

1) Coach Dashboard (таблиця учнів) — показує прогрес і активність.

2) Student Profile — деталізація по конкретному учню (ігри/пазли/домашнє).

3) Homework (сутність) — тренер задає вимірні завдання, учень виконує в RoboChess, тренер бачить прогрес.

4) Дані з зовнішніх платформ (Lichess, Chess.com) + внутрішні дані RoboChess (пазли/домашнє/тренажери).



## 1. Ролі і доступи

### 1.1 profiles.role

- admin

- coach

- student



### 1.2 Права

Admin:

- керує coach/student (створення/деактивація/ролі)

- (опційно) глобальні налаштування контенту/пазлів



Coach:

- бачить список своїх учнів (або всіх, якщо так налаштовано)

- заходить у Student Profile

- створює/призначає Homework

- бачить виконання Homework і деталізацію активності



Student:

- має власний кабінет

- бачить призначений Homework

- виконує задачі (пазли, ICheck, blind, тощо)

- бачить свій прогрес



## 2. Джерела даних (Data Sources)

### 2.1 Зовнішні

Lichess:

- games counts по time control (rapid/blitz) за 24h і 7d

- (опційно пізніше) рейтинги/пазли



Chess.com:

- games counts по time_class (rapid/blitz) за 24h і 7d

- (опційно пізніше) рейтинги/пазли



### 2.2 Внутрішні (RoboChess)

- student_puzzle_attempts (спроби пазлів, correctness, час, дата)

- Homework: призначення/виконання/відсоток

- Тренажери: ICheck, Blind (облік спроб/балів/правильно-неправильно/час)



## 3. Дані і таблиці (узгоджено з поточним Prisma)

### 3.1 Існуючі таблиці (вже в коді)

- profiles

  - id, email, full_name, username, role, avatar_url, xp, level, added_by_coach_id

- platform_connections

  - user_id, platform, platform_username, platform_user_id, last_synced_at

  - platform ∈ {'lichess','chesscom'} (фактичне значення в БД)

- stats_snapshots (історичні снепшоти)

  - captured_at, source

  - rapid_rating, blitz_rating, puzzle_rating

  - rapid_24h, rapid_7d, rapid_total

  - blitz_24h, blitz_7d, blitz_total

  - puzzle_24h, puzzle_7d, puzzle_total

- player_stats_v2 (оперативні обчислені counts)

  - student_id, platform, rapid_24h, rapid_7d, blitz_24h, blitz_7d, computed_at

- student_puzzle_attempts

  - user_id, puzzle_id, result, is_correct, time_spent_seconds, broken_on_move, attempt_date



### 3.2 Нові таблиці (додати для Homework і тренажерів RoboChess)

(Назви у snake_case, як існуючі)



A) homework

- id (uuid)

- coach_id (profiles.id)

- student_id (profiles.id)

- title (text)

- description (text, nullable)

- status (assigned|active|completed|archived)

- created_at, due_at (nullable)



B) homework_items (склад домашнього)

- id

- homework_id

- item_type ('puzzles'|'icheck'|'blind'|'master_games')

- target_count (int)

- target_score (int, nullable)

- target_minutes (int, nullable)



C) homework_progress (агрегація виконання)

- id

- homework_id

- student_id

- completed_count (int)

- completed_score (int, nullable)

- completed_minutes (int, nullable)

- completion_percent (int 0..100)

- updated_at



D) icheck_attempts (або trainer_attempts з trainer_type)

- id

- user_id

- score

- attempts_count

- duration_seconds

- attempt_date



E) blind_attempts

- id

- user_id

- result (win|loss|draw|aborted|custom)

- correct_moves (int nullable)

- total_moves (int nullable)

- duration_seconds

- attempt_date



Примітка: точні поля для icheck/blind можна мінімізувати в MVP (тільки те, що треба для % виконання Homework).



## 4. Сервіси синхронізації і снепшоти

### 4.1 Принцип

- UI (dashboard/profile) НІКОЛИ не звертається напряму до Lichess/Chess.com.

- UI читає тільки з Postgres (Supabase) через Prisma.

- Зовнішні API викликаються тільки бекенд-джобою (cron endpoint) або адміністративною кнопкою "Sync".



### 4.2 Поточні бекенд-роути (вже в коді)

- GET /api/coach/students

  - повертає список студентів + stats

  - для lichess counts використовує player_stats_v2 (stats_source=v2|none)

  - для chesscom зараз бере legacy зі stats_snapshots (тимчасово)

- GET /api/cron/update-stats-v2

  - зараз обробляє тільки Lichess студентів

  - пише в player_stats_v2 (upsert)



### 4.3 Вимога MVP по снепшотах

1) Зберігати "останній computed" для швидкого відображення:

   - player_stats_v2 (залишається як є: upsert)

2) Зберігати історію (для графіків/трендів) — через stats_snapshots:

   - додати запис у stats_snapshots на кожний sync (мінімально: captured_at, source, rapid_24h, rapid_7d, blitz_24h, blitz_7d, + рейтинги якщо є)

   - source = 'cron:v2' або подібне



(Якщо не хочемо змішувати рейтинги/пазли з games counts — можна додати окрему history-таблицю, але MVP дозволяє писати в stats_snapshots.)



## 5. Coach Dashboard (таблиця учнів) — що показує

### 5.1 Рядок таблиці (мінімально)

- Student display:

  - nickname (profiles.username || profiles.full_name)

  - avatar_url

- Connections:

  - platform (лічесс/чесском)

  - platform_username

- Ratings (з stats_snapshots.latest):

  - rapidRating

  - blitzRating

  - puzzleRating

- Games activity (24h/7d):

  - rapidGames24h

  - rapidGames7d

  - blitzGames24h

  - blitzGames7d

- Puzzles activity (7d) (з RoboChess або legacy):

  - puzzles7d (мінімально)

- Homework:

  - activeHomeworkCompletionPercent (0..100 або null)

  - lastHomeworkUpdateAt



### 5.2 API контракт (узгоджено з поточним /api/coach/students)

Поточний формат:

- id

- nickname

- platform

- platform_username

- avatar_url

- last_active

- stats:

  - rapidRating

  - blitzRating

  - puzzleRating

  - rapidGames24h

  - rapidGames7d

  - blitzGames24h

  - blitzGames7d

  - puzzles3d (фактично puzzle_24h)

  - puzzles7d (фактично puzzle_7d)

  - puzzle_total



MVP: лишаємо цей контракт, додаємо поступово homework-поля.



## 6. Student Profile — що показує

### 6.1 Summary блок

- Профіль: nickname, аватар, підключені акаунти (Lichess/Chess.com), остання синхронізація

- Рейтинги: rapid/blitz/puzzle (latest)

- Активність за 24h/7d: rapid/blitz games counts



### 6.2 Деталізація RoboChess

- Графік/таблиця пазлів по днях (7 або 14 днів): attempts, correct%, avg time

- ICheck по днях: attempts/score

- Blind по днях: attempts/result/score



### 6.3 Homework

- Список активних/минулых homework

- В кожному: items targets, виконано, %, статус



## 7. Homework — сутність і логіка

### 7.1 Призначення

Coach створює Homework для student:

- items:

  - puzzles target_count

  - icheck target_count/score

  - blind target_count

  - (опційно) master_games target_count



### 7.2 Облік виконання (MVP)

- puzzles: рахуємо по student_puzzle_attempts за період від created_at до due_at (або до now)

- icheck/blind: рахуємо по icheck_attempts/blind_attempts за період

- completion_percent = середнє по items або вагова схема (зафіксувати одну формулу і не міняти без CR)



## 8. Синхронізація зовнішніх платформ (MVP правила)

### 8.1 Частота

- Cron sync: 1 раз на 6–24 години (налаштовується)

- Manual sync кнопка (admin/coach) — опційно



### 8.2 Лічесс (як зараз)

- API: NDJSON games export

- Фільтр:

  - perfType=rapid|blitz

  - since=since7dMs

- Лічильник:

  - беремо lastMoveAt

  - games24h: lastMoveAt >= since24hMs

  - games7d: lastMoveAt >= since7dMs



### 8.3 Chess.com (додати в v2)

- API: /games/archives + останні N місяців

- time_class: rapid/blitz

- end_time (sec) → порівняння з since24h/since7d



## 9. Non-functional requirements

- Кеш/стабільність: UI читає з БД, зовнішні API тільки через cron.

- Rate limiting: обмеження по користувачах/платформах, затримки між викликами.

- Observability: логувати errors + зберігати computed_at.

- Дебаг: детальний debug тільки для debugUser, не для всіх.



## 10. Правила внесення змін (Change Control)

- FrozenSpec змінюється тільки через:

  1) короткий change request (що/чому/вплив)

  2) оновлення версії (0.1 → 0.2)

  3) після цього — задачі в Cursor

