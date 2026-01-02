/// <reference types="@cloudflare/workers-types" />

import { Agent, getAgentByName } from "agents";
import OpenAI from "openai";

interface Env {
  TIC_TAC_TOE_AGENT: DurableObjectNamespace<Agent>;
  OPENAI_API_KEY: string;
}

interface GameState {
  board: (string | null)[];
  currentPlayer: "X" | "O";
  winner: string | null;
  gameOver: boolean;
}

export class TicTacToeAgent extends Agent<Env, GameState> {
  initialState: GameState = {
    board: Array(9).fill(null),
    currentPlayer: "X",
    winner: null,
    gameOver: false,
  };

  async onConnect(connection: any) {
    // Send initial state when client connects
    connection.send(
      JSON.stringify({
        type: "state",
        state: this.state,
      }),
    );
  }

  async onMessage(connection: any, message: string | ArrayBuffer) {
    if (typeof message !== "string") return;

    try {
      const data = JSON.parse(message);

      if (data.type === "move" && typeof data.position === "number") {
        await this.handlePlayerMove(data.position, connection);
      } else if (data.type === "reset") {
        await this.resetGame(connection);
      }
    } catch (error) {
      console.error("Error handling message:", error);
      connection.send(
        JSON.stringify({
          type: "error",
          message: "Invalid message format",
        }),
      );
    }
  }

  async handlePlayerMove(position: number, connection: any) {
    // Validate move
    if (
      this.state.gameOver ||
      position < 0 ||
      position > 8 ||
      this.state.board[position] !== null ||
      this.state.currentPlayer !== "X"
    ) {
      connection.send(
        JSON.stringify({
          type: "error",
          message: "Invalid move",
        }),
      );
      return;
    }

    // Make player move
    const newBoard = [...this.state.board];
    newBoard[position] = "X";

    this.setState({
      ...this.state,
      board: newBoard,
      currentPlayer: "O",
    });

    // Check if player won
    const winner = this.checkWinner(newBoard);
    if (winner || this.isBoardFull(newBoard)) {
      this.setState({
        ...this.state,
        winner: winner,
        gameOver: true,
      });
      this.broadcastState(connection);
      return;
    }

    this.broadcastState(connection);

    // AI makes move after a short delay
    await this.makeAIMove(connection);
  }

  async makeAIMove(connection: any) {
    // Get AI move using chat completion
    const aiPosition = await this.getAIMoveFromChatCompletion();
    console.log({ aiPosition });
    if (aiPosition === null) {
      // Fallback to random move if AI fails
      const availablePositions = this.state.board
        .map((cell, i) => (cell === null ? i : null))
        .filter((i) => i !== null);

      if (availablePositions.length === 0) return;

      const randomIndex = Math.floor(Math.random() * availablePositions.length);
      const position = availablePositions[randomIndex]!;

      const newBoard = [...this.state.board];
      newBoard[position] = "O";

      this.setState({
        ...this.state,
        board: newBoard,
        currentPlayer: "X",
      });
    } else {
      const newBoard = [...this.state.board];
      newBoard[aiPosition] = "O";

      this.setState({
        ...this.state,
        board: newBoard,
        currentPlayer: "X",
      });
    }

    // Check if AI won
    const winner = this.checkWinner(this.state.board);
    if (winner || this.isBoardFull(this.state.board)) {
      this.setState({
        ...this.state,
        winner: winner,
        gameOver: true,
      });
    }

    this.broadcastState(connection);
  }

  async getAIMoveFromChatCompletion(): Promise<number | null> {
    // Format board as a visual markdown table
    // Empty cells show their position number, taken cells show X or O
    const formatCell = (cell: string | null, index: number) =>
      cell || String(index);

    const board = this.state.board;
    const boardTable = `
| ${formatCell(board[0], 0)} | ${formatCell(board[1], 1)} | ${formatCell(board[2], 2)} |
|---|---|---|
| ${formatCell(board[3], 3)} | ${formatCell(board[4], 4)} | ${formatCell(board[5], 5)} |
|---|---|---|
| ${formatCell(board[6], 6)} | ${formatCell(board[7], 7)} | ${formatCell(board[8], 8)} |`.trim();

    const prompt = `You are playing Tic-Tac-Toe as O. Here is the current board:

${boardTable}

Empty cells show their position number (0-8). X and O show taken positions.
You are O. Pick the best empty position to place your O.

Respond with ONLY a single digit (0-8) for your chosen position.`;

    try {
      const openai = new OpenAI({
        apiKey: this.env.OPENAI_API_KEY,
      });

      const response = await openai.chat.completions.create({
        model: "gpt-5.2",
        messages: [
          {
            role: "system",
            content:
              "You are a Tic-Tac-Toe expert. Respond only with a single number representing the board position.",
          },
          { role: "user", content: prompt },
        ],
        max_completion_tokens: 10,
      });

      // Extract number from response
      const responseText = response.choices[0]?.message?.content || "";
      console.log({ responseText });
      const match = responseText.match(/\b([0-8])\b/);

      if (match) {
        const position = parseInt(match[1]);
        // Validate the position is actually empty
        if (this.state.board[position] === null) {
          return position;
        }
      }

      return null; // Fallback to random
    } catch (error) {
      console.error("AI move error:", error);
      return null;
    }
  }

  checkWinner(board: (string | null)[]): string | null {
    const winPatterns = [
      [0, 1, 2],
      [3, 4, 5],
      [6, 7, 8], // rows
      [0, 3, 6],
      [1, 4, 7],
      [2, 5, 8], // columns
      [0, 4, 8],
      [2, 4, 6], // diagonals
    ];

    for (const pattern of winPatterns) {
      const [a, b, c] = pattern;
      if (board[a] && board[a] === board[b] && board[a] === board[c]) {
        return board[a];
      }
    }

    return null;
  }

  isBoardFull(board: (string | null)[]): boolean {
    return board.every((cell) => cell !== null);
  }

  async resetGame(connection: any) {
    this.setState({
      board: Array(9).fill(null),
      currentPlayer: "X",
      winner: null,
      gameOver: false,
    });

    this.broadcastState(connection);
  }

  broadcastState(connection: any) {
    connection.send(
      JSON.stringify({
        type: "state",
        state: this.state,
      }),
    );
  }
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);

    // WebSocket upgrade for agent connection
    if (url.pathname === "/ws") {
      const upgradeHeader = request.headers.get("Upgrade");
      if (upgradeHeader !== "websocket") {
        return new Response("Expected websocket", { status: 400 });
      }

      const stub = await getAgentByName(env.TIC_TAC_TOE_AGENT, "game");

      return stub.fetch(request);
    }

    // Serve HTML frontend
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(HTML_CONTENT, {
        headers: { "Content-Type": "text/html" },
      });
    }

    return new Response("Not found", { status: 404 });
  },
};

const HTML_CONTENT = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Tic-Tac-Toe Agent</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Courier New', monospace;
            background: #0a0a0a;
            min-height: 100vh;
            display: flex;
            justify-content: center;
            align-items: center;
            padding: 20px;
        }

        .container {
            background: #111;
            border-radius: 12px;
            padding: 40px;
            box-shadow: 0 0 40px rgba(0, 255, 65, 0.1);
            max-width: 500px;
            width: 100%;
            border: 1px solid #1a3a1a;
        }

        h1 {
            text-align: center;
            color: #00cc44;
            margin-bottom: 10px;
            font-size: 2.5em;
            text-shadow: 0 0 10px rgba(0, 204, 68, 0.3);
        }

        .subtitle {
            text-align: center;
            color: #3a5a3a;
            margin-bottom: 30px;
            font-size: 0.9em;
        }

        .status {
            text-align: center;
            font-size: 1.2em;
            margin-bottom: 20px;
            color: #00ff55;
            font-weight: bold;
            min-height: 30px;
        }

        .board {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 8px;
            margin-bottom: 30px;
            aspect-ratio: 1;
        }

        .cell {
            background: #1a1a1a;
            border: 1px solid #2a4a2a;
            border-radius: 8px;
            font-size: 3em;
            font-weight: bold;
            cursor: pointer;
            transition: all 0.3s ease;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .cell:hover:not(:disabled) {
            background: #1f2f1f;
            border-color: #3a6a3a;
            transform: scale(1.02);
        }

        .cell:disabled {
            cursor: not-allowed;
        }

        .cell.x {
            color: #00ff55;
            text-shadow: 0 0 8px rgba(0, 255, 85, 0.4);
        }

        .cell.o {
            color: #00aa44;
            text-shadow: 0 0 8px rgba(0, 170, 68, 0.3);
        }

        .controls {
            display: flex;
            gap: 10px;
            justify-content: center;
        }

        button {
            padding: 12px 30px;
            font-size: 1em;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            transition: all 0.3s ease;
            font-weight: bold;
            font-family: 'Courier New', monospace;
        }

        .reset-btn {
            background: #1a3a1a;
            color: #00ff55;
            border: 1px solid #2a5a2a;
        }

        .reset-btn:hover {
            background: #2a4a2a;
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(0, 255, 65, 0.2);
        }

        .connection-status {
            text-align: center;
            margin-top: 20px;
            font-size: 0.9em;
            color: #3a5a3a;
        }

        .connection-status.connected {
            color: #00cc44;
        }

        .connection-status.disconnected {
            color: #663333;
        }

        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.4; }
        }

        .thinking {
            animation: pulse 1.5s ease-in-out infinite;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Tic-Tac-Toe</h1>
        <p class="subtitle">Play against an AI Agent</p>
        
        <div class="status" id="status">Connecting...</div>
        
        <div class="board" id="board">
            <button class="cell" data-index="0"></button>
            <button class="cell" data-index="1"></button>
            <button class="cell" data-index="2"></button>
            <button class="cell" data-index="3"></button>
            <button class="cell" data-index="4"></button>
            <button class="cell" data-index="5"></button>
            <button class="cell" data-index="6"></button>
            <button class="cell" data-index="7"></button>
            <button class="cell" data-index="8"></button>
        </div>
        
        <div class="controls">
            <button class="reset-btn" id="resetBtn">New Game</button>
        </div>
        
        <div class="connection-status" id="connectionStatus">
            Disconnected
        </div>
    </div>

    <script>
        let ws;
        let gameState = {
            board: Array(9).fill(null),
            currentPlayer: 'X',
            winner: null,
            gameOver: false
        };

        function connect() {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = \`\${protocol}//\${window.location.host}/ws\`;
            
            ws = new WebSocket(wsUrl);
            
            ws.onopen = () => {
                console.log('Connected to agent');
                document.getElementById('connectionStatus').textContent = 'Connected';
                document.getElementById('connectionStatus').className = 'connection-status connected';
            };
            
            ws.onmessage = (event) => {
                const data = JSON.parse(event.data);
                
                if (data.type === 'state') {
                    gameState = data.state;
                    updateUI();
                } else if (data.type === 'error') {
                    console.error('Error:', data.message);
                }
            };
            
            ws.onclose = () => {
                console.log('Disconnected from agent');
                document.getElementById('connectionStatus').textContent = 'Disconnected';
                document.getElementById('connectionStatus').className = 'connection-status disconnected';
                setTimeout(connect, 2000);
            };
            
            ws.onerror = (error) => {
                console.error('WebSocket error:', error);
            };
        }

        function updateUI() {
            const cells = document.querySelectorAll('.cell');
            const statusEl = document.getElementById('status');
            
            cells.forEach((cell, index) => {
                const value = gameState.board[index];
                cell.textContent = value || '';
                cell.className = 'cell';
                if (value) {
                    cell.className += \` \${value.toLowerCase()}\`;
                }
                cell.disabled = value !== null || gameState.gameOver || gameState.currentPlayer !== 'X';
            });
            
            if (gameState.gameOver) {
                if (gameState.winner) {
                    statusEl.textContent = \`\${gameState.winner} wins\`;
                } else {
                    statusEl.textContent = "Draw";
                }
                statusEl.classList.remove('thinking');
            } else if (gameState.currentPlayer === 'X') {
                statusEl.textContent = 'Your turn [X]';
                statusEl.classList.remove('thinking');
            } else {
                statusEl.textContent = 'AI processing...';
                statusEl.classList.add('thinking');
            }
        }

        function makeMove(position) {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'move',
                    position: position
                }));
            }
        }

        function resetGame() {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'reset'
                }));
            }
        }

        document.getElementById('board').addEventListener('click', (e) => {
            if (e.target.classList.contains('cell')) {
                const position = parseInt(e.target.dataset.index);
                makeMove(position);
            }
        });

        document.getElementById('resetBtn').addEventListener('click', resetGame);

        connect();
    </script>
</body>
</html>`;
