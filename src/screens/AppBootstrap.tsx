import React, { useState } from 'react';
import REPL from './repl.js';
import SetupWizard from './setup/SetupWizard.js';
import { BootstrapStatus, checkBootstrapStatus } from '../config/bootstrap.js';

export default function AppBootstrap() {
  const [status, setStatus] = useState<BootstrapStatus>(() => checkBootstrapStatus());

  if (status.ok) {
    return <REPL />;
  }

  return (
    <SetupWizard
      initialStatus={status}
      onCompleted={() => {
        setStatus(checkBootstrapStatus());
      }}
    />
  );
}
