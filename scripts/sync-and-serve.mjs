import { spawn } from "node:child_process";

const steps = [
  ["node", ["scripts/knou-sync.mjs"]],
  ["npm", ["start"]],
];

for (const [command, args] of steps) {
  await run(command, args);
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", shell: true });
    child.on("exit", (code) => {
      if (code === 0 || args.includes("start")) resolve();
      else reject(new Error(`${command} ${args.join(" ")} failed with ${code}`));
    });
  });
}
