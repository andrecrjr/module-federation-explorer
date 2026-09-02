import React from 'react';

const Button = () => {
  return (
    <button
      style={{
        padding: '10px 20px',
        backgroundColor: '#646cff',
        color: 'white',
        border: 'none',
        borderRadius: '8px',
        cursor: 'pointer',
        fontSize: '1em',
        fontWeight: '500'
      }}
    >
      I am a Federated Button from Remote App
    </button>
  );
};

export default Button;
