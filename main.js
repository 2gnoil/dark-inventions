console.log('LOADED', Date.now());

const BPM = 60;
const BEAT_DURATION = 60000 / BPM;

const PERFECT_WINDOW = 40;
const GOOD_WINDOW = 120;

const MAX_HP = 10;
const HP_BAR_WIDTH = 200;
const HP_BAR_HEIGHT = 20;

const DAMAGE_TEXT_Y = 140;   // near HP bars
const STATUS_TEXT_Y = 360;   // existing resolve text position

const PERFECT_RESOLVE_GAP = 200; // ms between messages


const SHOW_TELEGRAPHS = false;

const MOVE_STEP = 18;   // pixels per movement pulse
const MOVE_TIME = 120; // ms per pulse

const RESOLVE_ANIM_TIME = 180; // slightly longer than tween duration




const BeatPhase = {
  ENEMY_INPUT: 'EnemyInput',
  PLAYER_INPUT: 'PlayerInput',
  ENEMY_RESOLVE: 'EnemyResolve',
  PLAYER_RESOLVE: 'PlayerResolve'
};

const BEAT_SEQUENCE = [
  BeatPhase.ENEMY_INPUT,
  BeatPhase.PLAYER_INPUT,
  BeatPhase.ENEMY_RESOLVE,
  BeatPhase.PLAYER_RESOLVE
];

const InputAction = {
  ATTACK: 'Attack',
  DEFEND: 'Defend',
  BUFF: 'Buff',
  DEBUFF: 'Debuff'
};

class MainScene extends Phaser.Scene {
  constructor() {
    super('MainScene');
    this.beatIndex = 0;
    this.pulseTweenTargetAngle = 0;
    this.currentPhase = null;
    this.beatStartTime = 0;
    this.currentBeatTargetTime = 0;
    this.playerInputLocked = false;
    this.player = {
      hp: 10,
      attack: 2,
      pendingDefense: null
    };

    this.enemy = {
      hp: 10,
      attack: 2,
      pendingDefense: null
    };

    this.queuedPlayerAction = null;
    this.queuedEnemyAction = null;
    this.isPaused = false;
    this.beatTimer = null;
    this.enemyIntentUI = null;
    this.maxTurns = 22;
    this.turnsRemaining = this.maxTurns;

    this.gameOver = false;
    this.gameOverText = null;
    this.lastPulsePhase = null;
    this.activePulseSide = null;
    this.musicStartTime = null;   // Phaser audio time when track starts
    this.beatLog = [];           // Array of per-beat diagnostics



  }

  preload() {
    this.load.audio('track', 'assets/60bpm_1_cmaj.mp3');

    // Player sprites
    this.load.image('player_neutral', 'assets/player_neutral.png');
    this.load.image('player_attack', 'assets/player_attack.png');
    this.load.image('player_defend', 'assets/player_defend.png');
    this.load.image('player_buff', 'assets/player_buff.png');
    this.load.image('player_debuff', 'assets/player_debuff.png');

    // Enemy sprites
    this.load.image('enemy_neutral', 'assets/enemy_neutral.png');
    this.load.image('enemy_attack', 'assets/enemy_attack.png');
    this.load.image('enemy_defend', 'assets/enemy_defend.png');
    this.load.image('enemy_buff', 'assets/enemy_buff.png');
    this.load.image('enemy_debuff', 'assets/enemy_debuff.png');
  }



  create() {
    this.started = false;
    this.startTime = 0;
    this.currentBeat = -1;

    this.startText = this.add.text(
      this.cameras.main.centerX,
      this.cameras.main.centerY,
      "CLICK TO BEGIN",
      {
        fontSize: "32px",
        color: "#ffffff",
        fontFamily: "Arial"
      }
    ).setOrigin(0.5);

    this.input.once('pointerdown', this.onStartClick, this);

    const centerY = this.cameras.main.centerY;

    // Tuned for 256×256 sprites
    this.PLAYER_X = this.cameras.main.width - 110;
    this.ENEMY_X = 110;

    this.PLAYER_Y = centerY;
    this.ENEMY_Y = centerY;


    // UI setup is OK before start
    this.createMetronome();

    const padding = 30;

    this.enemyHPBar = this.createHPBar(padding, padding + 20, 'ENEMY');
    this.playerHPBar = this.createHPBar(
      this.cameras.main.width - HP_BAR_WIDTH - padding,
      padding + 20,
      'PLAYER'
    );

    this.turnCounterText = this.add.text(
      this.cameras.main.centerX,
      40,
      `TURNS: ${this.turnsRemaining}`,
      {
        fontSize: '20px',
        color: '#ffffff',
        fontFamily: 'Arial'
      }
    ).setOrigin(0.5);

    this.updateHPBars();
    this.setupInput();
    this.createSprites();

    this.enemyArrows = this.createArrowCluster(120, this.cameras.main.height - 120, false);
    this.playerArrows = this.createArrowCluster(
      this.cameras.main.width - 120,
      this.cameras.main.height - 120,
      true
    );

    // Make each player arrow touch/click interactive
    Object.values(this.playerArrows.arrows).forEach(arrow => {
      arrow.setInteractive({ useHandCursor: true });
    });

    this.playerArrows.arrows.left.on('pointerdown', () => {
      this.onPlayerAction(InputAction.ATTACK, 'left');
    });

    this.playerArrows.arrows.right.on('pointerdown', () => {
      this.onPlayerAction(InputAction.DEFEND, 'right');
    });

    this.playerArrows.arrows.up.on('pointerdown', () => {
      this.onPlayerAction(InputAction.BUFF, 'up');
    });

    this.playerArrows.arrows.down.on('pointerdown', () => {
      this.onPlayerAction(InputAction.DEBUFF, 'down');
    });


    this.updateAttackUI(this.enemyArrows, this.enemy);
    this.updateAttackUI(this.playerArrows, this.player);

    this.isInputSwing = false;

    // 🚫 DO NOT start beats here
  }

  onPlayerAction(action, dir) {
    // Phase + lock checks
    if (this.currentPhase !== BeatPhase.PLAYER_INPUT) return;
    if (this.playerInputLocked) return;
    if (this.queuedPlayerAction) return;

    const inputTime = this.time.now;
    const timing = this.judgeTiming(inputTime);

    // 🔒 Lock immediately
    this.playerInputLocked = true;

    // ✅ Queue valid action only
    this.queuedPlayerAction = {
      type: action,
      timing
    };

    if (action === InputAction.DEFEND && timing !== 'Miss') {
      this.player.pendingDefense = timing;
    }

    // Sprite state
    this.setSpriteState(this.player, action);

    // UI feedback
    this.highlightArrow(this.playerArrows, dir);

    if (SHOW_TELEGRAPHS) {
      this.showTelegraphMessage(
        this.player,
        this.playerTelegraphText(action, timing)
      );
    }

    this.showTimingFeedback(timing);
  }




  onStartClick() {
    if (this.started) return; // safety guard

    this.started = true;

    this.startText.destroy();

    // Unlock audio
    this.sound.context.resume();

    // Start music
    this.music = this.sound.add('track');
    this.music.play();

    // Anchor timing
    this.startTime = this.time.now;
    this.currentBeat = -1;
    this.beatPhase = BeatPhase.ENEMY_INPUT;

    // ✅ NOW the game actually begins
    this.startNextBeat();
  }

  createSprites() {
    const cam = this.cameras.main;
    const centerY = cam.centerY;

    // Tuned for 256×256 sprites @ 0.6 scale
    const EDGE_OFFSET = 120;

    // PLAYER
    this.playerSprite = this.add.image(
      cam.width - EDGE_OFFSET,
      centerY,
      'player_neutral'
    );
    this.playerSprite.setScale(0.6);

    this.playerSprite.baseX = this.playerSprite.x;
    this.playerSprite.baseY = this.playerSprite.y;

    // ENEMY
    this.enemySprite = this.add.image(
      EDGE_OFFSET,
      centerY,
      'enemy_neutral'
    );
    this.enemySprite.setScale(0.6);

    this.enemySprite.baseX = this.enemySprite.x;
    this.enemySprite.baseY = this.enemySprite.y;

    // 🔑 Bind sprites to actors (important)
    this.player.sprite = this.playerSprite;
    this.enemy.sprite = this.enemySprite;
  }



  setSpriteState(actor, actionType) {
    const sprite =
      actor === this.player ? this.playerSprite : this.enemySprite;

    if (!actionType) {
      sprite.setTexture(
        actor === this.player ? 'player_neutral' : 'enemy_neutral'
      );
      return;
    }

    const prefix = actor === this.player ? 'player_' : 'enemy_';

    switch (actionType) {
      case InputAction.ATTACK:
        sprite.setTexture(prefix + 'attack');
        break;
      case InputAction.DEFEND:
        sprite.setTexture(prefix + 'defend');
        break;
      case InputAction.BUFF:
        sprite.setTexture(prefix + 'buff');
        break;
      case InputAction.DEBUFF:
        sprite.setTexture(prefix + 'debuff');
        break;
    }
  }


  getMetronomePhaseProgress() {
    const elapsed = this.time.now - this.lastBeatTime;
    return Phaser.Math.Clamp(elapsed / BEAT_DURATION, 0, 1);
  }



  checkWinConditions() {
    if (this.gameOver) return;

    // Player dead OR turns ran out → GAME OVER
    if (this.player.hp <= 0 || this.turnsRemaining <= 0) {
      this.endGame(false);
      return;
    }

    // Enemy dead AND turns remain → YOU WIN
    if (this.enemy.hp <= 0) {
      this.endGame(true);
    }
  }

  endGame(playerWon) {
    this.gameOver = true;

    // Freeze all time-based systems
    this.time.timeScale = 0;
    this.tweens.timeScale = 0;

    const text = playerWon ? 'YOU WIN!' : 'GAME OVER';
    const color = playerWon ? '#55ff55' : '#ff5555';

    this.gameOverText = this.add.text(
      this.cameras.main.centerX,
      this.cameras.main.centerY,
      text,
      {
        fontSize: '48px',
        color,
        fontFamily: 'Arial',
        stroke: '#000',
        strokeThickness: 4
      }
    ).setOrigin(0.5);
  }


  onBeat(beatIndex) {
    console.log('BEAT', beatIndex, 'PHASE', this.beatPhase);

    switch (this.beatPhase) {
      case BeatPhase.ENEMY_INPUT:
        this.handleEnemyInputBeat();
        this.beatPhase = BeatPhase.ENEMY_RES;
        break;

      case BeatPhase.ENEMY_RES:
        this.resolveEnemyAction();
        this.beatPhase = BeatPhase.PLAYER_INPUT;
        break;

      case BeatPhase.PLAYER_INPUT:
        this.handlePlayerInputBeat();
        this.beatPhase = BeatPhase.PLAYER_RES;
        break;

      case BeatPhase.PLAYER_RES:
        this.resolvePlayerAction();
        this.beatPhase = BeatPhase.ENEMY_INPUT;
        break;
    }
  }


  createArrowCluster(x, y, isPlayer) {
    const c = this.add.container(x, y);

    const style = { fontSize: '28px', color: '#666' };

    const arrows = {
      up: this.add.text(0, -30, '↑', style).setOrigin(0.5),
      down: this.add.text(0, 30, '↓', style).setOrigin(0.5),
      left: this.add.text(-30, 0, '←', style).setOrigin(0.5),
      right: this.add.text(30, 0, '→', style).setOrigin(0.5)
    };

    // 🔥 ATK text (placed near attack direction)
    const atkText = this.add.text(
      isPlayer ? -55 : 55,
      0,
      '',
      { fontSize: '14px', color: '#ffffff' }
    ).setOrigin(isPlayer ? 1 : 0, 0.5);

    c.add([...Object.values(arrows), atkText]);

    return { container: c, arrows, atkText, isPlayer };
  }

  updateAttackUI(cluster, actor) {
    cluster.atkText.setText(`ATK ${actor.attack}`);
  }


  highlightArrow(cluster, direction) {
    this.clearArrowHighlight(cluster);
    cluster.arrows[direction].setColor('#ffffff');
  }

  clearArrowHighlight(cluster) {
    Object.values(cluster.arrows).forEach(a =>
      a.setColor('#666')
    );
  }

  enemyActionToDirection(action) {
    switch (action) {
      case InputAction.ATTACK: return 'right';
      case InputAction.DEFEND: return 'left';
      case InputAction.BUFF: return 'up';
      case InputAction.DEBUFF: return 'down';
    }
  }

  updateTurnCounter() {
    this.turnCounterText.setText(
      `TURNS: ${this.turnsRemaining}`
    );
  }


  moveSprite(actor, dx, dy, delay = 0) {
    const sprite =
      actor === this.player ? this.playerSprite : this.enemySprite;

    const direction = actor === this.player ? -1 : 1;

    this.tweens.add({
      targets: sprite,
      x: sprite.x + dx * direction,
      y: sprite.y + dy,
      delay,
      duration: MOVE_TIME,
      ease: 'Sine.easeOut'
    });
  }



  startNextBeat() {

    if (!this.started || this.gameOver) return;
    // 1️⃣ Advance phase explicitly
    if (this.currentPhase == null) {
      // First beat bootstrap
      this.currentPhase = BeatPhase.ENEMY_INPUT;
    } else {
      switch (this.currentPhase) {
        case BeatPhase.ENEMY_INPUT:
          this.currentPhase = BeatPhase.PLAYER_INPUT;
          break;

        case BeatPhase.PLAYER_INPUT:
          this.currentPhase = BeatPhase.ENEMY_RESOLVE;
          break;

        case BeatPhase.ENEMY_RESOLVE:
          this.currentPhase = BeatPhase.PLAYER_RESOLVE;
          break;

        case BeatPhase.PLAYER_RESOLVE:
          this.currentPhase = BeatPhase.ENEMY_INPUT;
          break;
      }
    }
    console.log('PHASE:', this.currentPhase);

    console.log(
      `Beat ${this.beatIndex + 1}: ${this.currentPhase}`
    );

    if (this.currentPhase === BeatPhase.ENEMY_INPUT) {
      this.time.delayedCall(RESOLVE_ANIM_TIME, () => {
        const resetDelay = MOVE_TIME * 2; // enough for perfect (2-step) moves
        this.resetSprite(this.player, resetDelay);
        this.resetSprite(this.enemy, resetDelay);
      });
    }



    // ── ENEMY_INPUT phase setup ─────────────────────
    if (this.currentPhase === BeatPhase.ENEMY_INPUT) {
      // Clear enemy defense from previous beat
      this.activePulseSide = 'enemy';
      this.enemy.pendingDefense = null;
    }

    // ── PLAYER_INPUT phase setup ────────────────────
    if (this.currentPhase === BeatPhase.PLAYER_INPUT) {
      this.activePulseSide = 'player';
      this.playerInputLocked = false;

      // Clear player defense from previous beat
      this.player.pendingDefense = null;
    }


    // 2️⃣ Establish beat timing (critical for judging input)
    this.beatStartTime = this.time.now;

    const tweenDuration = BEAT_DURATION * 0.9;

    // Target time for timing judgment
    this.currentBeatTargetTime =
      this.beatStartTime + tweenDuration;

    // 3️⃣ PLAYER_INPUT phase setup
    if (this.currentPhase === BeatPhase.PLAYER_INPUT) {
      this.playerInputLocked = false;

      // 🔐 Reset one-beat defensive stance at phase start
      this.player.pendingDefense = null;
    }


    // 4️⃣ Swing metronome
    this.swingMetronome(this.currentPhase, tweenDuration, () => {

      // ── ENEMY INPUT ───────────────────────────────
      if (this.currentPhase === BeatPhase.ENEMY_INPUT) {
        this.chooseEnemyAction();
      }

      // ── ENEMY RESOLVE ─────────────────────────────
      if (this.currentPhase === BeatPhase.ENEMY_RESOLVE) {

        const enemyAction = this.queuedEnemyAction;

        if (enemyAction) {
          const { type, timing } = enemyAction;

          // ATTACK
          if (type === InputAction.ATTACK) {
            this.moveSprite(this.enemy, MOVE_STEP, 0);
          }

          // DEFEND
          if (type === InputAction.DEFEND) {
            this.moveSprite(this.enemy, -MOVE_STEP, 0);
          }

          // BUFF
          if (type === InputAction.BUFF) {
            this.moveSprite(this.enemy, 0, -MOVE_STEP);
          }

          // DEBUFF
          if (type === InputAction.DEBUFF) {
            this.moveSprite(this.enemy, 0, MOVE_STEP);
          }

          this.animateResolve(this.enemy, type);
        }

        const isEnemyAttack =
          this.queuedEnemyAction?.type === InputAction.ATTACK;

        const playerDefended =
          this.player.pendingDefense === 'Good' ||
          this.player.pendingDefense === 'Perfect';

        // 🕒 Enemy attack intercepted by player defense → defer to PLAYER_RESOLVE
        if (isEnemyAttack && playerDefended) {
          const effects = this.resolveAction(
            this.enemy,
            this.player,
            this.queuedEnemyAction
          );

          // Mark all effects to resolve on PLAYER_RESOLVE
          effects.forEach(effect => {
            effect.delayToPhase = BeatPhase.PLAYER_RESOLVE;
          });

          this.applyEffects(effects);
        } else {
          // Normal enemy resolution
          const effects = this.resolveAction(
            this.enemy,
            this.player,
            this.queuedEnemyAction
          );

          this.applyEffects(effects);
        }

        if (this.queuedEnemyAction) {
          this.animateResolve(this.enemy, this.queuedEnemyAction.type);
        }


        this.queuedEnemyAction = null;
        this.clearEnemyIntent();
        this.clearArrowHighlight(this.enemyArrows);
      }


      // ── PLAYER RESOLVE ────────────────────────────
      if (this.currentPhase === BeatPhase.PLAYER_RESOLVE) {
        // grab the action before we null it
        const playerAction = this.queuedPlayerAction;

        if (playerAction) {
          // resolve logic
          const effects = this.resolveAction(
            this.player,
            this.enemy,
            playerAction
          );
          this.applyEffects(effects);

          // movement logic must use *playerAction*, not this.queuedPlayerAction
          const { type, timing } = playerAction;
          const forward = MOVE_STEP;
          const backward = -MOVE_STEP;


          // ATTACK
          if (type === InputAction.ATTACK) {
            const steps = timing === 'Perfect' ? 2 : 1;
            for (let i = 0; i < steps; i++) {
              this.moveSprite(this.player, forward, 0, i * MOVE_TIME);
            }
          }

          // BUFF
          if (type === InputAction.BUFF) {
            const steps = timing === 'Perfect' ? 2 : 1;
            for (let i = 0; i < steps; i++) {
              this.moveSprite(this.player, 0, -MOVE_STEP, i * MOVE_TIME);
            }
          }

          // DEBUFF
          if (type === InputAction.DEBUFF) {
            const steps = timing === 'Perfect' ? 2 : 1;
            for (let i = 0; i < steps; i++) {
              this.moveSprite(this.player, 0, MOVE_STEP, i * MOVE_TIME);
            }
          }


          // DEFEND
          if (type === InputAction.DEFEND) {
            this.moveSprite(this.player, backward, 0);

            // PERFECT PARRY
            const enemyWasAttacking =
              this.queuedEnemyAction?.type === InputAction.ATTACK;

            if (timing === 'Perfect' && enemyWasAttacking) {
              this.moveSprite(this.player, forward, 0, MOVE_TIME);
            }

          }

          // animateResolve
          this.animateResolve(this.player, type, {
            parry:
              type === InputAction.DEFEND &&
              timing === 'Perfect' &&
              this.enemy.pendingDefense === InputAction.ATTACK
          });

          // clear the queued action
          this.queuedPlayerAction = null;
        }



        // ✅ Apply delayed effects scheduled for PLAYER_RESOLVE
        this.flushDelayedEffects(BeatPhase.PLAYER_RESOLVE);

        this.clearTelegraph(this.player);
        this.clearArrowHighlight(this.playerArrows);

        this.turnsRemaining--;

        this.updateTurnCounter();
        this.checkWinConditions();
      }

      // 5️⃣ Advance beat index AFTER all resolution
      this.beatIndex++;

      // 6️⃣ Small delay before next beat
      this.time.delayedCall(
        BEAT_DURATION * 0.1,
        () => this.startNextBeat()
      );
    });
  }





  setupInput() {
    if (this.gameOver) return;

    this.input.keyboard.on('keydown', (event) => {
      if (!event.code.startsWith('Arrow')) return;
      event.preventDefault();

      const action = this.mapKeyToAction(event.code);
      if (!action) return;

      const dir = this.playerKeyToDirection(event.code);
      this.onPlayerAction(action, dir);
    });

    // Pause toggle (unchanged)
    this.input.keyboard.on('keydown-SPACE', () => {
      this.togglePause();
    });
  }



  playerKeyToDirection(code) {
    switch (code) {
      case 'ArrowLeft': return 'left';
      case 'ArrowRight': return 'right';
      case 'ArrowUp': return 'up';
      case 'ArrowDown': return 'down';
    }
  }


  playerTelegraphText(action, timing) {
    if (timing === 'Miss') {
      return `Missed ${action.toLowerCase()}`;
    }

    switch (action) {
      case InputAction.ATTACK:
        return timing === 'Perfect'
          ? 'Preparing strong attack'
          : 'Preparing attack';
      case InputAction.DEFEND:
        return timing === 'Perfect'
          ? 'Ready to parry'
          : 'Ready to dodge';
      case InputAction.BUFF:
        return 'Empowering self';
      case InputAction.DEBUFF:
        return 'Weakening foe';
    }
  }


  emitResolveSequence(entity, messages, style = {}) {
    if (!entity) {
      console.error('emitResolveSequence: missing entity');
      return;
    }

    // 🔒 Normalize to array
    if (!Array.isArray(messages)) {
      messages = [messages];
    }

    messages.forEach((msg, i) => {
      this.time.delayedCall(
        i * PERFECT_RESOLVE_GAP,
        () => {
          this.showFloatingText(entity, msg, style);
        }
      );
    });
  }



  togglePause() {
    this.isPaused = !this.isPaused;

    if (this.isPaused) {
      this.time.timeScale = 0;
      this.tweens.timeScale = 0;
      console.log('⏸ PAUSED');
    } else {
      this.time.timeScale = 1;
      this.tweens.timeScale = 1;
      console.log('▶️ RESUMED');
    }
  }


  createHPBar(x, y, labelText) {
    const container = this.add.container(x, y);

    const label = this.add.text(0, -18, labelText, {
      fontSize: '14px',
      color: '#ffffff'
    }).setOrigin(0, 0.5);

    const bg = this.add.rectangle(
      0,
      0,
      HP_BAR_WIDTH,
      HP_BAR_HEIGHT,
      0x333333
    ).setOrigin(0, 0.5);

    const fill = this.add.rectangle(
      0,
      0,
      HP_BAR_WIDTH,
      HP_BAR_HEIGHT,
      0xff3333
    ).setOrigin(0, 0.5);

    container.add([label, bg, fill]);

    return { container, fill };
  }

  updateHPBars() {
    const enemyRatio = this.enemy.hp / MAX_HP;
    const playerRatio = this.player.hp / MAX_HP;

    this.enemyHPBar.fill.width =
      HP_BAR_WIDTH * Phaser.Math.Clamp(enemyRatio, 0, 1);

    this.playerHPBar.fill.width =
      HP_BAR_WIDTH * Phaser.Math.Clamp(playerRatio, 0, 1);
  }




  clearEnemyIntent() {
    if (this.enemyIntentUI) {
      this.enemyIntentUI.destroy();
      this.enemyIntentUI = null;
    }
  }


  chooseEnemyAction() {
    const actions = [
      InputAction.ATTACK,
      InputAction.DEFEND,
      InputAction.BUFF,
      InputAction.DEBUFF
    ];

    // 🔐 Clear last-beat defense at phase entry
    this.enemy.pendingDefense = null;

    const choice =
      actions[Math.floor(Math.random() * actions.length)];

    const timing = 'Good'; // can expand later

    this.queuedEnemyAction = {
      type: choice,
      timing
    };

    this.setSpriteState(this.enemy, this.queuedEnemyAction.type);

    // 🛡️ Arm enemy defense immediately
    if (choice === InputAction.DEFEND) {
      this.enemy.pendingDefense = timing;
    }

    // Always show arrow intent
    const dir = this.enemyActionToDirection(this.queuedEnemyAction.type);
    this.highlightArrow(this.enemyArrows, dir);

    // Optional telegraph text
    if (SHOW_TELEGRAPHS) {
      this.showEnemyIntent(this.queuedEnemyAction);
    }



    console.log(
      `Enemy intent: ${choice}, defense: ${this.enemy.pendingDefense}`
    );
  }




  showTelegraphMessage(actor, text) {
    this.clearTelegraph(actor);

    const isPlayer = actor === this.player;

    const cluster = isPlayer ? this.playerArrows : this.enemyArrows;

    const x = cluster.container.x;
    const y = cluster.container.y - 60; // directly above arrows

    const msg = this.add.text(x, y, text, {
      fontSize: '16px',
      color: '#ffffff',
      align: 'center'
    }).setOrigin(0.5);

    actor.telegraphUI = msg;
  }

  clearTelegraph(actor) {
    if (actor.telegraphUI) {
      actor.telegraphUI.destroy();
      actor.telegraphUI = null;
    }
  }


  showEnemyIntent(action) {
    this.clearEnemyIntent();

    const msg = this.add.text(
      this.enemyArrows.container.x,
      this.enemyArrows.container.y - 60,
      this.enemyTelegraphText(action.type),
      { fontSize: '16px', color: '#fff' }
    ).setOrigin(0.5);

    this.enemyIntentUI = msg;
  }


  enemyTelegraphText(type) {
    switch (type) {
      case InputAction.ATTACK: return 'Preparing attack';
      case InputAction.DEFEND: return 'Preparing defense';
      case InputAction.BUFF: return 'Empowering self';
      case InputAction.DEBUFF: return 'Weakening foe';
    }
  }


  getEnemyArrow(actionType) {
    switch (actionType) {
      case InputAction.ATTACK:
        return '→'; // toward player
      case InputAction.DEFEND:
        return '←';
      case InputAction.BUFF:
        return '↑';
      case InputAction.DEBUFF:
        return '↓';
      default:
        return '?';
    }
  }





  resolveAction(actor, target, action) {
    if (!action) return [];
    if (action.timing === 'Miss') return [];

    const effects = [];

    switch (action.type) {

      // ───────────────────────── ATTACK ─────────────────────────
      case InputAction.ATTACK: {
        const effects = [];
        const isPerfect = action.timing === 'Perfect';

        // Base damage
        let baseDamage = actor.attack;

        // Add perfect bonus
        if (isPerfect) {
          baseDamage += 1;
        }

        const defenseTiming =
          target.pendingDefense === 'Good' ||
            target.pendingDefense === 'Perfect'
            ? target.pendingDefense
            : null;


        // ── TARGET DEFENDING ─────────────────────────────
        if (defenseTiming) {

          // ─────────────────────────────────────────────
          // PLAYER DEFENDING
          // ─────────────────────────────────────────────
          if (target === this.player) {

            // PERFECT DEFENSE → PARRY
            if (defenseTiming === 'Perfect') {
              effects.push({
                type: 'damage',
                source: target,
                target: actor,
                amount: 1,
                tags: ['parry']
              });

              effects.push({
                type: 'blocked',
                source: target,
                target: actor,
                label: 'PARRY'
              });

              return effects;
            }

            // GOOD DEFENSE → leak 1 if enemy ATK > 1
            if (actor.attack > 1) {
              effects.push({
                type: 'damage',
                source: actor,
                target,
                amount: 1,
                tags: ['leak']
              });
            }

            effects.push({
              type: 'blocked',
              source: target,
              target: actor,
              label: 'BLOCK'
            });

            return effects;
          }

          // ─────────────────────────────────────────────
          // ENEMY DEFENDING
          // ─────────────────────────────────────────────

          // Good attack vs defend → full block
          if (!isPerfect) {
            effects.push({
              type: 'blocked',
              source: target,
              target: actor,
              label: 'BLOCK'
            });
            return effects;
          }

          // Perfect attack vs defend → leak exactly 1
          effects.push({
            type: 'blocked',
            source: target,
            target: actor,
            label: 'BLOCK',
            timing: action.timing
          });

          effects.push({
            type: 'damage',
            source: actor,
            target,
            amount: 1,
            timing: action.timing,
            tags: ['leak']
          });


          return effects;
        }


        // ── NO DEFENSE ─────────────────────────────
        if (baseDamage > 0) {
          effects.push({
            type: 'damage',
            source: actor,
            target,
            amount: actor.attack,      // base ATK
            bonus: isPerfect ? 1 : 0,  // perfect bonus
            timing: action.timing
          });

        }

        return effects;
      }



      // ───────────────────────── DEFEND ─────────────────────────
      case InputAction.DEFEND:
        // Defense is applied at input time
        return [];

      // ───────────────────────── BUFF ───────────────────────────
      case InputAction.BUFF: {
        let amount = 1;

        // Player-only perfect bonus
        if (actor === this.player && action.timing === 'Perfect') {
          amount = 2;
        }

        effects.push({
          type: 'stat',
          source: actor,
          target: actor,
          stat: 'attack',
          amount,
          timing: action.timing
        });


        return effects;
      }


      // ───────────────────────── DEBUFF ─────────────────────────
      case InputAction.DEBUFF: {
        let amount = -1;

        // Player-only perfect bonus
        if (actor === this.player && action.timing === 'Perfect') {
          amount = -2;
        }

        effects.push({
          type: 'stat',
          source: actor,
          target,
          stat: 'attack',
          amount,
          timing: action.timing
        });

        return effects;
      }

    }

    return effects;
  }



  applySingleEffect(effect) {

    // ───────────────────────── DAMAGE ─────────────────────────
    if (effect.type === 'damage') {

      // PERFECT DAMAGE (base + bonus)
      if (
        effect.timing === 'Perfect' &&
        typeof effect.bonus === 'number' &&
        effect.bonus > 0
      ) {


        const base = effect.amount;
        const bonus = effect.bonus;

        const isPlayer = effect.target === this.player;
        const x = isPlayer
          ? this.playerHPBar.container.x + HP_BAR_WIDTH / 2
          : this.enemyHPBar.container.x + HP_BAR_WIDTH / 2;

        const y = DAMAGE_TEXT_Y;

        // Visual: two hits
        this.emitResolveSequence(
          effect.target,
          [`-${base}`, `-${bonus}`],
          { color: '#ff5555', isDamage: true }
        );


        // Apply total damage ONCE
        this.applyDamage({
          ...effect,
          amount: base + bonus
        });

        return;
      }

      // PERFECT leak-only (after block)
      if (effect.timing === 'Perfect' && effect.tags?.includes('leak')) {
        this.applyDamage(effect);
        return;
      }

      // NORMAL DAMAGE
      this.applyDamage(effect);
      return;
    }


    // ───────────────────────── BLOCK ─────────────────────────
    if (effect.type === 'blocked') {

      // Perfect block + leak already queued separately
      if (effect.timing === 'Perfect') {
        this.showFloatingText(
          effect.source,
          effect.label || 'BLOCK',
          {
            color: '#88ccff',
            isDefense: true,
            yOffset: 18
          }
        );
        return;
      }

      // Normal block
      this.showFloatingText(
        effect.source,
        effect.label || 'BLOCK',
        {
          color: '#88ccff',
          isDefense: true,
          yOffset: 18
        }
      );
      return;
    }


    // ───────────────────────── STAT ─────────────────────────
    if (effect.type === 'stat') {

      // PERFECT BUFF / DEBUFF → two visual pulses, one math application
      if (effect.timing === 'Perfect' && Math.abs(effect.amount) === 2) {

        const single = effect.amount / 2; // +1 or -1
        const sign = single > 0 ? '+' : '';
        const label = `${sign}${single} ${effect.stat.toUpperCase()}`;

        // 🎯 Visual: two identical messages
        this.emitResolveSequence(
          effect.target,
          [label, label],
          { color: single > 0 ? '#55ff55' : '#ff5555' }
        );

        // 🧮 Math: apply full stat once, NO text
        this.applyStatChange({
          ...effect,
          suppressText: true
        });

        return;
      }

      // NORMAL STAT CHANGE
      this.applyStatChange(effect);
      return;
    }

  }


  animateResolve(actor, actionType) {
    const sprite =
      actor === this.player ? this.playerSprite : this.enemySprite;

    const key =
      actor === this.player
        ? `player_${actionType.toLowerCase()}`
        : `enemy_${actionType.toLowerCase()}`;

    sprite.setTexture(key);
  }



  resetSprite(actor, delay = 0) {
    const sprite =
      actor === this.player ? this.playerSprite : this.enemySprite;

    const neutralKey =
      actor === this.player ? 'player_neutral' : 'enemy_neutral';

    this.tweens.add({
      targets: sprite,
      x: sprite.baseX,
      y: sprite.baseY,
      duration: MOVE_TIME,
      delay,
      ease: 'Sine.easeInOut',
      onComplete: () => {
        sprite.setTexture(neutralKey);
      }
    });
  }





  flushDelayedEffects(phase) {
    if (!this.pendingEffects || this.pendingEffects.length === 0) return;

    const remaining = [];

    this.pendingEffects.forEach(effect => {
      if (effect.delayToPhase === phase) {
        this.applySingleEffect(effect);
      } else {
        remaining.push(effect);
      }
    });

    this.pendingEffects = remaining;
  }


  applyEffects(effects) {
    if (!effects || effects.length === 0) return;

    // Storage for delayed effects
    this.pendingEffects ??= [];

    effects.forEach(effect => {
      // Delay handling
      if (
        effect.delayToPhase &&
        effect.delayToPhase !== this.currentPhase
      ) {
        this.pendingEffects.push(effect);
        return;
      }

      // Immediate application
      this.applySingleEffect(effect);
    });
  }



  applyDamage(effect) {
    effect.target.hp -= effect.amount;
    this.updateHPBars();

    if (effect.suppressText) return;

    const label = `-${effect.amount}`;

    this.showFloatingText(
      effect.target,
      label,
      {
        color: '#ff5555',
        isDamage: true
      }
    );
  }



  updateActorUI(actor) {
    const cluster =
      actor === this.player ? this.playerArrows : this.enemyArrows;
    this.updateAttackUI(cluster, actor);
  }


  applyStatChange(effect) {
    const stat = effect.stat;
    const target = effect.target;

    target[stat] += effect.amount;

    // 🚧 Clamp attack to minimum 0
    if (stat === 'attack') {
      target.attack = Math.max(0, target.attack);
    }

    // 🔁 Update UI
    if (target === this.player) {
      this.updateAttackUI(this.playerArrows, this.player);
    } else {
      this.updateAttackUI(this.enemyArrows, this.enemy);
    }

    if (effect.suppressText) return;

    const sign = effect.amount > 0 ? '+' : '';
    this.showFloatingText(
      target,
      `${sign}${effect.amount} ${stat.toUpperCase()}`,
      {
        color: effect.amount > 0 ? '#55ff55' : '#ff5555'
      }
    );
  }


  showFloatingText(entity, text, style = {}) {
    const isPlayer = entity === this.player;
    const isHpBarText = style.isDamage || style.isDefense;

    // ── HP BAR TEXT (damage / block / parry) ──
    if (isHpBarText) {
      const x = isPlayer
        ? this.playerHPBar.container.x + HP_BAR_WIDTH / 2
        : this.enemyHPBar.container.x + HP_BAR_WIDTH / 2;

      const baseY = DAMAGE_TEXT_Y;
      const y = baseY + (style.yOffset || 0);

      const msg = this.add.text(x, y, text, {
        fontSize: '16px',
        color: style.color || '#fff'
      }).setOrigin(0.5);

      this.tweens.add({
        targets: msg,
        y: y - 20,
        alpha: 0,
        duration: 600,
        onComplete: () => msg.destroy()
      });

      return;
    }

    // ── ARROW-CLUSTER TEXT (buffs / debuffs) ──
    const cluster = isPlayer ? this.playerArrows : this.enemyArrows;
    const baseY = cluster.container.y - 80;
    const y = baseY + (style.yOffset || 0);

    const msg = this.add.text(
      cluster.container.x,
      y,
      text,
      {
        fontSize: '16px',
        color: style.color || '#fff'
      }
    ).setOrigin(0.5);

    this.tweens.add({
      targets: msg,
      y: y - 20,
      alpha: 0,
      duration: 600,
      onComplete: () => msg.destroy()
    });
  }


  mapKeyToAction(code) {
    switch (code) {
      case 'ArrowLeft':
        return InputAction.ATTACK;
      case 'ArrowRight':
        return InputAction.DEFEND;
      case 'ArrowUp':
        return InputAction.BUFF;
      case 'ArrowDown':
        return InputAction.DEBUFF;
      default:
        return null;
    }
  }

  judgeTiming(inputTime) {
    const delta = inputTime - this.currentBeatTargetTime;
    const absDelta = Math.abs(delta);

    if (absDelta <= PERFECT_WINDOW) return 'Perfect';
    if (absDelta <= GOOD_WINDOW) return 'Good';
    return 'Miss';
  }


  showTimingFeedback(timing) {
    const x = this.cameras.main.centerX;
    const y = this.cameras.main.height - 220;

    let color = '#ffffff';
    let text = timing.toUpperCase();

    switch (timing) {
      case 'Perfect':
        color = '#ffd700'; // gold
        break;
      case 'Good':
        color = '#ffffff';
        break;
      case 'Miss':
        color = '#888888';
        break;
    }

    const feedbackText = this.add.text(x, y, text, {
      fontFamily: 'Arial',
      fontSize: '32px',
      color: color
    }).setOrigin(0.5);

    this.tweens.add({
      targets: feedbackText,
      y: y - 30,
      alpha: 0,
      duration: 450,
      ease: 'Cubic.easeOut',
      onComplete: () => {
        feedbackText.destroy();
      }
    });
  }


  createMetronome() {
    const centerX = this.cameras.main.centerX;
    const bottomY = this.cameras.main.height - 50;

    this.metronome = this.add.container(centerX, bottomY);

    const needle = this.add.graphics();
    needle.lineStyle(4, 0xffffff);
    needle.beginPath();
    needle.moveTo(0, 0);
    needle.lineTo(0, -150);
    needle.strokePath();

    this.metronome.add(needle);
    this.metronome.rotation = 0;
  }

  swingMetronome(phase, duration, onExtreme) {
    let targetAngleDeg = 0;

    if (phase === BeatPhase.ENEMY_INPUT) {
      targetAngleDeg = -45;
      this.isInputSwing = true;
      this.pulseTweenTargetAngle = Phaser.Math.DegToRad(-45);
    }

    if (phase === BeatPhase.PLAYER_INPUT) {
      targetAngleDeg = 45;
      this.isInputSwing = true;
      this.pulseTweenTargetAngle = Phaser.Math.DegToRad(45);
    }


    if (
      phase === BeatPhase.ENEMY_RESOLVE ||
      phase === BeatPhase.PLAYER_RESOLVE
    ) {
      this.isInputSwing = false; // 🔴 critical
      this.activePulseSide = null;
      targetAngleDeg =
        this.metronome.rotation > 0 ? -45 : 45;
    }

    this.tweens.add({
      targets: this.metronome,
      rotation: Phaser.Math.DegToRad(targetAngleDeg),
      duration,
      ease: 'Sine.easeInOut',
      onComplete: () => {
        if (onExtreme) onExtreme();
      }
    });
  }




}

const config = {
  type: Phaser.AUTO,
  width: 800,
  height: 600,
  backgroundColor: '#000000',
  scene: MainScene
};

new Phaser.Game(config);
